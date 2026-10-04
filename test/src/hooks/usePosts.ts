import { useEffect, useState } from "react";
import type {PostInfo} from "~/types/post";

export function usePosts(blogId?: string) {
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [loading, setLoading] = useState(Boolean(blogId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!blogId) {
      setPosts([]);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    async function loadPosts() {
      try {
        const response = await fetch(`/api/posts?blogId=${encodeURIComponent(blogId!)}`);

        if (!response.ok) {
          throw new Error(`게시글 목록을 불러오지 못했습니다. (${response.status})`);
        }

        const data = (await response.json()) as PostInfo[];

        if (cancelled) return;

        setPosts(data);
      } catch (error) {
        if (cancelled) return;

        console.error(error);
        setPosts([]);
        setError(error instanceof Error ? error.message : "게시글 목록을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPosts();

    return () => {
      cancelled = true;
    };
  }, [blogId]);

  return {
    posts,
    loading,
    error,
  };
}