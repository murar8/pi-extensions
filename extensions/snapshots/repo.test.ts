import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { promisify, stripVTControlCharacters } from "node:util";
import type { TestContext } from "node:test";
import { Repo } from "./repo.ts";

const execFileAsync = promisify(execFile);

// Git's built-in empty tree.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// A dir removed after t.
async function createTempDir(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "pi-test-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  return dir;
}

// The index files in a repo.
async function indexFiles(gitDir: string) {
  const names = await readdir(gitDir);
  return names.filter((name) => name.startsWith("index-"));
}

void describe("Repo", { concurrency: true }, () => {
  void test("restore brings back the saved files", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    await writeFile(join(workTree, "a.txt"), "a");
    const tree = await repo.save();
    await writeFile(join(workTree, "a.txt"), "A");
    await writeFile(join(workTree, "b.txt"), "b");
    await repo.restore(tree);
    assert.equal(await readFile(join(workTree, "a.txt"), "utf8"), "a");
    await assert.rejects(readFile(join(workTree, "b.txt")), { code: "ENOENT" });
  });

  void test("restore ignores the work tree's attributes", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    await writeFile(join(workTree, ".gitattributes"), "* text eol=crlf");
    await writeFile(join(workTree, "a.txt"), "a\n");
    const tree = await repo.save();
    await writeFile(join(workTree, "a.txt"), "A\n");
    await repo.restore(tree);
    assert.equal(await readFile(join(workTree, "a.txt"), "utf8"), "a\n");
  });

  void test("diffStat and diff show the change between trees", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    await writeFile(join(workTree, "a.txt"), "a");
    const from = await repo.save();
    await writeFile(join(workTree, "a.txt"), "A");
    const to = await repo.save();
    const stat = await repo.diffStat(from, to);
    assert.equal(stat, "1 file changed, 1 insertion(+), 1 deletion(-)");
    assert.match(stripVTControlCharacters(await repo.diff(from, to)), /^\+A$/m);
  });

  void test("close removes the index", async (t) => {
    const workTree = await createTempDir(t);
    const gitDir = await createTempDir(t);
    const repo = await Repo.open(workTree, gitDir);
    await repo.save();
    assert.notDeepEqual(await indexFiles(gitDir), []);
    await repo.close();
    assert.deepEqual(await indexFiles(gitDir), []);
  });

  void test("reopening keeps the snapshots", async (t) => {
    const workTree = await createTempDir(t);
    const gitDir = await createTempDir(t);
    await writeFile(join(workTree, "a.txt"), "a");
    const repo = await Repo.open(workTree, gitDir);
    const tree = await repo.save();
    await writeFile(join(workTree, "a.txt"), "A");
    const reopened = await Repo.open(workTree, gitDir);
    await reopened.restore(tree);
    assert.equal(await readFile(join(workTree, "a.txt"), "utf8"), "a");
  });

  void test("save skips files git can't add", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    await writeFile(join(workTree, "a.txt"), "a");
    // A nested repo without commits.
    const nested = join(workTree, "nested");
    await execFileAsync("git", ["init", "--quiet", nested]);
    const tree = await repo.save();
    const stat = await repo.diffStat(EMPTY_TREE, tree);
    assert.equal(stat, "1 file changed, 1 insertion(+)");
  });

  void test("a failing git command rejects with its exit code", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    const stat = repo.diffStat(EMPTY_TREE, "missing");
    await assert.rejects(stat, { message: /^git diff exited 128: / });
  });

  void test("a missing work tree rejects", async (t) => {
    const workTree = await createTempDir(t);
    const repo = await Repo.open(workTree, await createTempDir(t));
    await rm(workTree, { recursive: true });
    await assert.rejects(repo.save(), { message: /^git add failed: / });
  });

  void test("a slow git command rejects", async (t) => {
    const gitDir = await createTempDir(t);
    // Git blocks reading HEAD until a writer opens it.
    await execFileAsync("mkfifo", [join(gitDir, "HEAD")]);
    const repo = await Repo.open(await createTempDir(t), gitDir, 100);
    await assert.rejects(repo.save(), { message: "git add timed out" });
  });
});
