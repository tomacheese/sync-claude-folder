/**
 * Small filesystem utilities.
 * Glob matching, path expansion and recursive traversal, implemented without dependencies.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'

/** Expands a leading `~` to the home directory. */
export function expandHome(targetPath: string): string {
  if (targetPath === '~') {
    return os.homedir()
  }
  return targetPath.startsWith('~/') || targetPath.startsWith('~\\')
    ? path.join(os.homedir(), targetPath.slice(2))
    : targetPath
}

/** Normalizes OS path separators to POSIX (`/`). */
export function toPosixPath(targetPath: string): string {
  return targetPath.split(path.sep).join('/')
}

/** Resolves a canonical relative path strictly below the destination root. */
export function resolveDestinationPath(root: string, relPath: string): string {
  const segments = relPath.split('/')
  if (
    relPath.includes('\\') ||
    relPath.includes('\0') ||
    segments.some(
      (segment) =>
        ['', '.', '..'].includes(segment) ||
        path.win32.parse(segment).root !== ''
    )
  ) {
    throw new Error(`Invalid destination relative path: ${relPath}`)
  }

  const destRoot = path.resolve(expandHome(root))
  const destPath = path.resolve(destRoot, ...segments)
  const relative = path.relative(destRoot, destPath)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Destination path escapes root: ${relPath}`)
  }
  return destPath
}

/**
 * Rejects symlink parents below the configured root, without following the leaf.
 * Call again before applying a plan because parents may have changed since planning.
 */
export async function validateDestinationPath(
  root: string,
  relPath: string
): Promise<string> {
  const destPath = resolveDestinationPath(root, relPath)
  let parent = path.resolve(expandHome(root))
  const parentSegments = relPath.split('/').slice(0, -1)
  for (const segment of parentSegments) {
    parent = path.join(parent, segment)
    const stat = await fs.lstat(parent).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!stat) {
      break
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Destination parent is a symlink: ${parent}`)
    }
    if (!stat.isDirectory()) {
      throw new Error(`Destination parent is not a directory: ${parent}`)
    }
  }
  return destPath
}

/**
 * Recursively walks a directory and returns the relative paths (POSIX separators)
 * of files and symlinks, optionally including directories.
 * Missing entries abort traversal unless a missing root is explicitly allowed.
 * @param root Directory to walk (absolute path)
 * @param options Traversal options for optional destinations and directory protection
 * @param options.allowMissingRoot Whether an absent root is treated as empty
 * @param options.includeDirectories Whether directory paths are included in the result
 * @returns Paths relative to the root (POSIX separators)
 */
export async function walkFiles(
  root: string,
  options: { allowMissingRoot?: boolean; includeDirectories?: boolean } = {}
): Promise<string[]> {
  const result: string[] = []

  /** Recursively walks `dir`, appending to `result`. */
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (
        dir === root &&
        options.allowMissingRoot &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return
      }
      throw error
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (options.includeDirectories) {
          result.push(toPosixPath(path.relative(root, absolutePath)))
        }
        await walk(absolutePath)
        continue
      }
      // Files and symlinks are included in the result
      result.push(toPosixPath(path.relative(root, absolutePath)))
    }
  }

  await walk(root)
  return result
}

/** Cache from glob pattern string to RegExp. */
const globRegExpCache = new Map<string, RegExp>()

/**
 * Converts a glob pattern (supporting `*`, `**` and `?`) to a RegExp.
 * Results are cached at module level to avoid recompiling the same pattern.
 * `**` matches any length including path separators, and `**\/` also allows zero directory levels.
 * `*` matches any length excluding path separators; `?` matches one character other than a path separator.
 * @param pattern Glob pattern
 * @returns Anchored (full-match) regular expression
 */
export function globToRegExp(pattern: string): RegExp {
  const cached = globRegExpCache.get(pattern)
  if (cached) {
    return cached
  }
  let regExpSource = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // `**/` matches zero or more directory levels
          regExpSource += '(?:.*/)?'
          i += 2
        } else {
          // `**` matches any length, including path separators
          regExpSource += '.*'
          i += 1
        }
      } else {
        // `*` matches any length, excluding path separators
        regExpSource += '[^/]*'
      }
    } else if (char === '?') {
      regExpSource += '[^/]'
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regExpSource += `\\${char}`
    } else {
      regExpSource += char
    }
  }
  const regexp = new RegExp(`^${regExpSource}$`)
  globRegExpCache.set(pattern, regexp)
  return regexp
}

/** Returns true if the path (POSIX separators) matches the glob pattern. */
export function matchGlob(pattern: string, targetPath: string): boolean {
  return globToRegExp(pattern).test(targetPath)
}

/** Returns true if the path (POSIX separators) matches any of the glob patterns. */
export function matchAnyGlob(patterns: string[], targetPath: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, targetPath))
}
