import { useEffect, useState } from "react";

const SELECTED_BLOG_ID_KEY = "selectedBlogId";

export function useBlogs() {
  const [blogIds, setBlogIds] = useState<string[]>([]);
  const [blogId, setBlogIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadBlogs() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/blogs");

        if (!response.ok) {
          throw new Error(`블로그 ID 목록을 불러오지 못했습니다. (${response.status})`);
        }

        const data = (await response.json()) as string[];

        if (cancelled) return;

        setBlogIds(data);

        if (data.length === 0) {
          setBlogIdState("");
          localStorage.removeItem(SELECTED_BLOG_ID_KEY);
          return;
        }

        const savedBlogId = localStorage.getItem(SELECTED_BLOG_ID_KEY);
        const nextBlogId = savedBlogId && data.includes(savedBlogId) ? savedBlogId : data[0];

        setBlogIdState(nextBlogId);
        localStorage.setItem(SELECTED_BLOG_ID_KEY, nextBlogId);
      } catch (error) {
        if (cancelled) return;

        console.error(error);
        setBlogIds([]);
        setBlogIdState("");
        setError(error instanceof Error ? error.message : "블로그 ID 목록을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBlogs();

    return () => {
      cancelled = true;
    };
  }, []);

  const setBlogId = (nextBlogId: string) => {
    if (!blogIds.includes(nextBlogId)) return;

    setBlogIdState(nextBlogId);
    localStorage.setItem(SELECTED_BLOG_ID_KEY, nextBlogId);
  };

  return {
    blogIds,
    blogId,
    setBlogId,
    loading,
    error,
  };
}