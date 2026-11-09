export interface Scope {
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

const SUBTREE_SUFFIX = "/*";

function subtreePrefix(pattern: string): string | null {
  return pattern.endsWith(SUBTREE_SUFFIX) ? pattern.slice(0, -1) : null;
}

export function resourceMatches(pattern: string, resource: string): boolean {
  const prefix = subtreePrefix(pattern);
  if (prefix === null) {
    return pattern === resource;
  }
  return resource.length > prefix.length && resource.startsWith(prefix);
}

function patternCovers(parent: string, child: string): boolean {
  if (parent === child) {
    return true;
  }
  const childPrefix = subtreePrefix(child);
  if (childPrefix === null) {
    return resourceMatches(parent, child);
  }
  const parentPrefix = subtreePrefix(parent);
  return parentPrefix !== null && childPrefix.startsWith(parentPrefix);
}

export function allowsAction(scope: Scope, action: string): boolean {
  return scope.actions.includes(action);
}

export function allowsResource(scope: Scope, resource: string): boolean {
  return scope.resources.some((pattern) => resourceMatches(pattern, resource));
}

export function scopeCovers(parent: Scope, child: Scope): boolean {
  return (
    child.actions.every((action) => parent.actions.includes(action)) &&
    child.resources.every((resource) =>
      parent.resources.some((pattern) => patternCovers(pattern, resource)),
    )
  );
}
