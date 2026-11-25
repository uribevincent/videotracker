
export default async function handler() {
  const urls = [
    "https://rmz.cr/l/s",
    "https://rmz.cr/l/s/2"
  ];

  const results = await Promise.all(
    urls.map(async url => {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          },
          signal: AbortSignal.timeout(15000)
        });

        const html = await response.text();

        return {
          url,
          status: response.status,
          contentType: response.headers.get("content-type"),
          htmlLength: html.length,
          containsBlogPost: html.includes("blog-post"),
          preview: html.slice(0, 200)
        };
      } catch (error) {
        return {
          url,
          error: error.message
        };
      }
    })
  );

  return new Response(JSON.stringify(results, null, 2), {
    headers: {
      "Content-Type": "application/json"
    }
  });
}
