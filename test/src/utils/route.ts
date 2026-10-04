export function getPostRoute(blogId: string, postId: string) {
  return `/post/${encodeURIComponent(blogId)}/${encodeURIComponent(postId)}`;
}