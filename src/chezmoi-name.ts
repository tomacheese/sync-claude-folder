/**
 * Resolves chezmoi source file names into real names, entry types and attributes.
 *
 * Not every chezmoi attribute is supported; only the subset actually used by the
 * dot_claude source is interpreted (dot_ / private_ / executable_ / readonly_ /
 * exact_ / literal_ / symlink_ / .tmpl / script prefixes such as run_* and create_*).
 *
 * Reference: https://www.chezmoi.io/reference/source-state-attributes/
 */

/** Entry type after materialization. */
export type ChezmoiEntryType = 'file' | 'dir' | 'symlink'

/** The chezmoi attributes handled by this tool. */
export interface ChezmoiAttributes {
  /** private_: owner-only read/write permissions (0600). */
  private: boolean
  /** readonly_: read-only. */
  readonly: boolean
  /** executable_: set the executable bit. */
  executable: boolean
  /** exact_: treat the directory contents as a managed mirror (delegated to the `mirror` setting in this tool). */
  exact: boolean
}

/** Resolution result for one source-name segment. */
export interface ResolvedChezmoiName {
  /** Converted real name (one segment). */
  name: string
  /** Entry type. */
  type: ChezmoiEntryType
  /** Resolved attributes. */
  attrs: ChezmoiAttributes
  /**
   * True when an attribute this tool does not handle (.tmpl, run_* scripts, etc.) was detected.
   * Callers must skip such entries.
   */
  ignore: boolean
}

/** Resolution result for a whole source path. */
export interface ResolvedChezmoiPath {
  /** Converted real-name path (POSIX separators). */
  targetPath: string
  /** Type of the last segment's entry. */
  type: ChezmoiEntryType
  /** Attributes of the last segment's entry. */
  attrs: ChezmoiAttributes
  /** True if any segment in the path is ignored. */
  ignore: boolean
}

/** Returns default `ChezmoiAttributes` with every flag false. */
function defaultAttrs(): ChezmoiAttributes {
  return { private: false, readonly: false, executable: false, exact: false }
}

/**
 * Source-name prefixes that are ignored instead of interpreted.
 * run_, create_, modify_, remove_, onchange_, encrypted_, empty_ and external_
 * either do not occur in the target files or are script-type entries, so they are out of scope.
 * (Variants like run_once_ are covered by the run_ prefix match.)
 */
const IGNORED_PREFIXES = [
  'run_',
  'create_',
  'modify_',
  'remove_',
  'onchange_',
  'encrypted_',
  'empty_',
  'external_',
]

/**
 * Resolves a source name (one path segment) into a real name, type and attributes.
 * @param sourceName File/directory name in the chezmoi source (one segment)
 * @returns Resolution result
 */
export function resolveChezmoiName(sourceName: string): ResolvedChezmoiName {
  let name = sourceName
  const attrs = defaultAttrs()
  let type: ChezmoiEntryType = 'file'

  // Templates (.tmpl) are not supported, so ignore
  if (name.endsWith('.tmpl')) {
    return { name, type, attrs, ignore: true }
  }

  // Script-type prefixes such as run_* / create_* are ignored
  for (const prefix of IGNORED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return { name, type, attrs, ignore: true }
    }
  }

  // symlink_ is parsed as a leading type prefix
  if (name.startsWith('symlink_')) {
    type = 'symlink'
    name = name.slice('symlink_'.length)
  }

  // Repeatedly parse private_/readonly_/executable_/exact_ until literal_ / .literal appears
  let literal = false
  let changed = true
  while (changed && !literal) {
    changed = false
    if (name.startsWith('private_')) {
      attrs.private = true
      name = name.slice('private_'.length)
      changed = true
    } else if (name.startsWith('readonly_')) {
      attrs.readonly = true
      name = name.slice('readonly_'.length)
      changed = true
    } else if (name.startsWith('executable_')) {
      attrs.executable = true
      name = name.slice('executable_'.length)
      changed = true
    } else if (name.startsWith('exact_')) {
      attrs.exact = true
      if (type !== 'symlink') {
        type = 'dir'
      }
      name = name.slice('exact_'.length)
      changed = true
    } else if (name.startsWith('literal_')) {
      literal = true
      name = name.slice('literal_'.length)
    } else if (name.endsWith('.literal')) {
      literal = true
      name = name.slice(0, -'.literal'.length)
    }
  }

  // Convert dot_ to '.' only when no literal marker was given
  if (!literal && name.startsWith('dot_')) {
    name = '.' + name.slice('dot_'.length)
  }

  return { name, type, attrs, ignore: false }
}

/**
 * Resolves a source-relative path (POSIX separators) into a real-name path.
 * {@link resolveChezmoiName} is applied to each segment; if any segment is ignored, the whole path is ignored.
 * @param relPath Path relative to the source directory (POSIX separators)
 * @returns Resolution result
 */
export function resolveChezmoiPath(relPath: string): ResolvedChezmoiPath {
  const segments = relPath.split('/')
  const targetSegments: string[] = []
  let ignore = false
  let type: ChezmoiEntryType = 'file'
  let attrs = defaultAttrs()

  for (const [index, segment] of segments.entries()) {
    const resolved = resolveChezmoiName(segment)
    if (resolved.ignore) {
      ignore = true
    }
    targetSegments.push(resolved.name)
    if (index !== segments.length - 1) {
      continue
    }

    type = resolved.type
    attrs = resolved.attrs
  }

  return { targetPath: targetSegments.join('/'), type, attrs, ignore }
}
