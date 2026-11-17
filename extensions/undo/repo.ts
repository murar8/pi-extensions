import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// A git command that exited non-zero.
class GitError extends Error {
  readonly code: number | undefined;

  constructor(command: string, code: number | undefined, stderr: string) {
    super(`${command} exited ${String(code)}: ${stderr.trim()}`);
    this.code = code;
  }
}

// A private repo snapshotting a work tree, leaving the work tree's own git
// state untouched.
export class Repo {
  #workTree: string;
  #gitDir: string;
  #timeout: number;

  private constructor(workTree: string, gitDir: string, timeout: number) {
    this.#workTree = workTree;
    this.#gitDir = gitDir;
    this.#timeout = timeout;
  }

  // Opens the repo, creating it if missing. The work tree and gitDir mustn't
  // overlap, as saving would add the repo to itself. Times out each git
  // command after `timeout` ms.
  static async open(workTree: string, gitDir: string, timeout = 5000) {
    await mkdir(gitDir, { recursive: true });
    const repo = new Repo(workTree, gitDir, timeout);
    await repo.#init();
    return repo;
  }

  // A per-process index, so concurrent processes don't collide on its lock.
  get #indexFile() {
    return join(this.#gitDir, `index-${process.pid}`);
  }

  // Runs git against the repo. Rejects with a short message on failure or
  // timeout.
  #git(subcommand: string, ...args: string[]) {
    // Leaves out the args, as hashes would flood the message.
    const command = `git ${subcommand}`;
    // Passes only PATH, and hides global and system config and the work tree's
    // attributes, so files are stored byte for byte.
    const env = {
      PATH: process.env["PATH"],
      GIT_DIR: this.#gitDir,
      GIT_WORK_TREE: this.#workTree,
      GIT_INDEX_FILE: this.#indexFile,
      GIT_CONFIG_NOSYSTEM: "1",
      // Git's built-in empty tree, which needs no object in the repo.
      GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    };
    return new Promise<string>((resolve, reject) => {
      const options = { cwd: this.#workTree, env, timeout: this.#timeout };
      const argv = [subcommand, ...args];
      execFile("git", argv, options, (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
        } else if (error.killed) {
          reject(new Error(`${command} timed out`));
        } else if (typeof error.code === "string") {
          // Never ran, like when git or the work tree is missing.
          reject(new Error(`${command} failed: ${error.message}`));
        } else {
          reject(new GitError(command, error.code, stderr));
        }
      });
    });
  }

  // Creates the repo if missing. Re-running init would rewrite the config,
  // racing other processes on its lock.
  async #init() {
    try {
      await access(join(this.#gitDir, "HEAD"));
    } catch {
      await this.#git("init", "--quiet");
    }
  }

  // Stages the work tree, skipping files git can't add, like nested repos
  // without commits. Git exits 1 if it skipped any.
  async #addAll() {
    try {
      await this.#git("add", "--all", "--ignore-errors");
    } catch (error) {
      if (!(error instanceof GitError && error.code === 1)) throw error;
    }
  }

  // Writes the work tree to the repo, returning its tree hash.
  async save() {
    await this.#addAll();
    return this.#git("write-tree");
  }

  // Resets the work tree to `tree`, staging it first so files added since the
  // last save are removed too.
  async restore(tree: string) {
    await this.#addAll();
    await this.#git("read-tree", "-u", "--reset", tree);
  }

  // The one-line diffstat between two trees.
  diffStat(from: string, to: string) {
    return this.#git("diff", "--shortstat", from, to);
  }

  // The colored patch between two trees.
  diff(from: string, to: string) {
    return this.#git("diff", "--color=always", from, to);
  }

  // Removes this process's index.
  async close() {
    await rm(this.#indexFile, { force: true });
  }
}
