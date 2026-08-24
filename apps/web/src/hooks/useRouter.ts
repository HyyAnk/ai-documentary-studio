import { useCallback, useEffect, useMemo, useState } from "react";
import type { Page } from "../components/types";

export type RouteState = {
  page: Page;
  channelId: string | null;
  episodeId: string | null;
  tab: string | null;
  group: string | null;
  rawHash: string;
};

export function parseHash(hash: string): RouteState {
  const cleanHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart = "", queryPart = ""] = cleanHash.split("?");

  const queryParams = new URLSearchParams(queryPart);
  const tab = queryParams.get("tab");
  const group = queryParams.get("group");

  // Normalize path segments, ignoring empty strings
  const segments = pathPart
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  const root = segments[0] || "dashboard";

  if (root === "dashboard" || root === "") {
    return {
      page: "dashboard",
      channelId: null,
      episodeId: null,
      tab,
      group,
      rawHash: hash,
    };
  }

  if (root === "tasks") {
    return {
      page: "tasks",
      channelId: null,
      episodeId: null,
      tab,
      group,
      rawHash: hash,
    };
  }

  if (root === "settings") {
    return {
      page: "settings",
      channelId: null,
      episodeId: null,
      tab,
      group,
      rawHash: hash,
    };
  }

  if (root === "channels") {
    const channelId = segments[1] ? decodeURIComponent(segments[1]) : null;
    const isEpisodesSegment = segments[2] === "episodes";
    const episodeId = isEpisodesSegment && segments[3] ? decodeURIComponent(segments[3]) : null;

    return {
      page: "channels",
      channelId,
      episodeId,
      tab,
      group,
      rawHash: hash,
    };
  }

  // Fallback to dashboard
  return {
    page: "dashboard",
    channelId: null,
    episodeId: null,
    tab,
    group,
    rawHash: hash,
  };
}

export function buildHash(state: {
  page: Page;
  channelId?: string | null;
  episodeId?: string | null;
  tab?: string | null;
  group?: string | null;
}): string {
  let path = `/${state.page}`;
  if (state.page === "channels" && state.channelId) {
    path = `/channels/${encodeURIComponent(state.channelId)}`;
    if (state.episodeId) {
      path += `/episodes/${encodeURIComponent(state.episodeId)}`;
    }
  }

  const params = new URLSearchParams();
  if (state.tab) params.set("tab", state.tab);
  if (state.group) params.set("group", state.group);

  const queryString = params.toString();
  return `#${path}${queryString ? `?${queryString}` : ""}`;
}

export function useRouter() {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash || "#/dashboard"));

  useEffect(() => {
    // Ensure initial hash exists
    if (!window.location.hash) {
      window.location.replace("#/dashboard");
    }

    const handleHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    const targetHash = to.startsWith("#") ? to : `#${to}`;
    if (replace) {
      const url = new URL(window.location.href);
      url.hash = targetHash;
      window.location.replace(url.toString());
    } else {
      window.location.hash = targetHash;
    }
    setRoute(parseHash(targetHash));
  }, []);

  const openPage = useCallback((page: Page) => {
    if (page === "channels") {
      navigate("/channels");
    } else {
      navigate(`/${page}`);
    }
  }, [navigate]);

  const openChannel = useCallback((channelId: string, tab?: string) => {
    if (!channelId) {
      navigate("/channels");
      return;
    }
    const query = tab ? `?tab=${encodeURIComponent(tab)}` : "";
    navigate(`/channels/${encodeURIComponent(channelId)}${query}`);
  }, [navigate]);

  const openEpisode = useCallback((channelId: string, episodeId: string, tab?: string) => {
    const query = tab ? `?tab=${encodeURIComponent(tab)}` : "";
    navigate(`/channels/${encodeURIComponent(channelId)}/episodes/${encodeURIComponent(episodeId)}${query}`);
  }, [navigate]);

  const setQueryParam = useCallback((key: string, value: string | null, replace = true) => {
    const currentHash = window.location.hash || "#/dashboard";
    const [pathPart = "", queryPart = ""] = (currentHash.startsWith("#") ? currentHash.slice(1) : currentHash).split("?");
    const params = new URLSearchParams(queryPart);

    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const nextQuery = params.toString();
    const nextHash = `#${pathPart}${nextQuery ? `?${nextQuery}` : ""}`;
    navigate(nextHash, replace);
  }, [navigate]);

  return useMemo(() => ({
    route,
    page: route.page,
    channelId: route.channelId,
    episodeId: route.episodeId,
    tab: route.tab,
    group: route.group,
    navigate,
    openPage,
    openChannel,
    openEpisode,
    setQueryParam,
  }), [route, navigate, openPage, openChannel, openEpisode, setQueryParam]);
}
