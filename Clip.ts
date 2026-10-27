export const CAP = 30000;

export function clip(): { add: (str: string) => void; text: () => string } {
  const half = CAP / 2;
  const keep = half - 64;
  let head = "";
  let tail = "";
  let gone = 0;
  const add = (str: string) => {
    const n = half - head.length;
    head += str.slice(0, n);
    tail += str.slice(n);
    if (tail.length > CAP) {
      gone += tail.length - keep;
      tail  = tail.slice(-keep);
    }
  };
  const text = () => {
    if (gone === 0 && head.length + tail.length <= CAP) {
      return head + tail;
    }
    const cut  = tail.length - keep;
    return unpinned_copy(head + "\n[... " + (gone + cut) + " characters cut ...]\n" + tail.slice(cut));
  };
  return { add, text };
}

function unpinned_copy(text: string): string {
  return new TextDecoder().decode(new TextEncoder().encode(text));
}

export function clip_end(str: string, at: number): number {
  if (str.length - at <= CAP) {
    return str.length;
  }
  const nl  = str.lastIndexOf("\n", at + CAP - 1);
  const low = str.charCodeAt(at + CAP) >> 10 === 0x37;
  return nl >= at ? nl + 1 : at + CAP - (low ? 1 : 0);
}

export function clip_pages(str: string): string[] {
  const pages: string[] = [];
  let at = 0;
  do {
    const end = clip_end(str, at);
    pages.push(str.slice(at, end));
    at = end;
  } while (at < str.length);
  return pages;
}

export function clip_page(str: string, at: number): string {
  const end = clip_end(str, at);
  const on  = "\n[characters " + (at + 1) + "-" + end + " of " + str.length + "; go on with at " + end + "]";
  return str.slice(at, end) + (end < str.length ? on : "");
}

export async function* stream_lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string[]> {
  const reader = stream.getReader();
  const utf8 = new TextDecoder();
  let rest = "";
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    const text = utf8.decode(got.value, { stream: true });
    const nl = text.lastIndexOf("\n");
    if (nl >= 0) {
      yield (rest + text.slice(0, nl)).split("\n");
      rest = "";
    }
    rest += text.slice(nl + 1);
  }
  yield [rest + utf8.decode()];
}
