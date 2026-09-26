export function getPostRoute(postId: string) {
  return `/post/${encodeURIComponent(postId)}`;
}
