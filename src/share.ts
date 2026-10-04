// Install links carry the whole script in the URL fragment (#…), compressed. Nothing is
// stored on the server, and the fragment never even reaches it.

export interface SharedScript {
  name: string;
  code: string;
}

const PREFIX = "v1.";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShare(script: SharedScript): Promise<string> {
  const json = JSON.stringify({ n: script.name, c: script.code });
  const compressed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return PREFIX + toBase64Url(compressed);
}

export async function decodeShare(token: string): Promise<SharedScript> {
  if (!token.startsWith(PREFIX)) throw new Error("Unknown link format");
  const json = new TextDecoder().decode(await pipe(fromBase64Url(token.slice(PREFIX.length)), new DecompressionStream("deflate-raw")));
  const data = JSON.parse(json) as { n?: unknown; c?: unknown };
  if (typeof data.n !== "string" || typeof data.c !== "string") throw new Error("Malformed link");
  return { name: data.n, code: data.c };
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "shortcut"
  );
}

export async function installLink(origin: string, script: SharedScript): Promise<string> {
  return `${origin}/s/${slugify(script.name)}#${await encodeShare(script)}`;
}
