import { useEffect, useState } from "react";
import type { PostInfo } from "../types/post";

export function usePosts() {
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/posts")
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PostInfo[]>;
      })
      .then(data => {
        if (cancelled) return;
        setPosts(data);
      })
      .catch(error => {
        if (cancelled) return;

        console.error(error);
        setError("게시글 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    posts,
    loading,
    error,
  };
}
