const ORIGIN = "https://notion-to-html-production.up.railway.app";
const CANONICAL_HOST = "no7ion.com";
const NOTION_ALIAS_HOST = "app.no7ion.com";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const originUrl = new URL(request.url);
    const origin = new URL(ORIGIN);

    originUrl.protocol = origin.protocol;
    originUrl.hostname = origin.hostname;
    originUrl.port = "";

    if (incomingUrl.hostname.toLowerCase() === NOTION_ALIAS_HOST && incomingUrl.pathname.startsWith("/p/")) {
      originUrl.pathname = `/https:/app.notion.com${incomingUrl.pathname}`;
      originUrl.search = incomingUrl.search;
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

    const init = {
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      headers,
      method: request.method,
      redirect: "manual",
    };

    const response = await fetch(originUrl.toString(), init);
    return rewriteResponse(response);
  },
};

function rewriteResponse(response) {
  const headers = new Headers(response.headers);
  const location = headers.get("location");

  if (location) {
    headers.set("location", rewriteLocation(location));
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function rewriteLocation(location) {
  let url;

  try {
    url = new URL(location, ORIGIN);
  } catch {
    return location;
  }

  if (url.hostname !== new URL(ORIGIN).hostname) return location;

  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return url.toString();
}
