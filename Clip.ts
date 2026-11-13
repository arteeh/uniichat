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

// a message's pages in memory, each its own line there (#151): a long
// text's detail goes beyond one line. Tool output, mostly files and logs
// still on disk, is split only past a page as shown (CAP), so a whole
// page and its trailer stay one
const SPLIT = 4000;
const SPLIT_ECHO = CAP + 1000;

export function split_of(kind: string): number {
  return kind === "echo" ? SPLIT_ECHO : SPLIT;
}

// equal pages, each cut at a line's end near its share where there is one,
// never inside a surrogate pair: where the cap leaves no room for that, one
// page more
export function clip_pages(str: string, most = SPLIT): string[] {
  for (let n = Math.max(1, Math.ceil(str.length / most)); ; n++) {
    const pages = pages_of(str, most, n);
    if (pages !== null) {
      return pages;
    }
  }
}

function pages_of(str: string, most: number, n: number): string[] | null {
  const pages: string[] = [];
  let at = 0;
  for (let left = n; left > 1; left--) {
    const share = (str.length - at) / left;
    const want = at + Math.round(share);
    const low  = Math.max(at + Math.ceil(share * 7 / 8), str.length - (left - 1) * most);
    const high = Math.max(low, Math.min(at + most, at + Math.floor(share * 9 / 8), str.length - 1));
    const back = str.lastIndexOf("\n", want - 1);
    const on = str.indexOf("\n", want - 1);
    const near = [back, on].filter((nl) => nl >= 0 && nl + 1 >= low && nl + 1 <= high).sort((a, b) => Math.abs(a + 1 - want) - Math.abs(b + 1 - want));
    let end = near.length > 0 ? near[0] + 1 : Math.min(high, Math.max(low, want));
    if (str.charCodeAt(end) >> 10 === 0x37 && str.charCodeAt(end - 1) >> 10 === 0x36) {
      if (end - 1 >= low && end - 1 > at) {
        end--;
      } else if (end + 1 <= high) {
        end++;
      } else {
        return null;
      }
    }
    pages.push(str.slice(at, end));
    at = end;
  }
  pages.push(str.slice(at));
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
