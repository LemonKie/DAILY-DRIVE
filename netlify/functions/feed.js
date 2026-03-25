export default async (req) => {
  const url = new URL(req.url).searchParams.get('url')
  if (!url) return new Response('Missing url param', { status: 400 })

  try {
    const res = await fetch(url)
    const body = await res.text()
    return new Response(body, {
      headers: { 'Content-Type': 'text/xml', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (e) {
    return new Response('Fetch failed', { status: 502 })
  }
}
