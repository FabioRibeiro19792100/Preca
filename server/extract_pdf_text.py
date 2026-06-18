import json
import re
import sys

from pypdf import PdfReader

VALUE_RE = re.compile(r"(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{2})?")
CPF_RE = re.compile(r"\d{3}\.\d{3}\.\d{3}-\d{2}")
CNPJ_RE = re.compile(r"\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}")
DATA_RE = re.compile(r"\b\d{1,2}\/\d{1,2}\/\d{2,4}\b")
PROC_RE = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")


def normalize_money(raw: str):
    try:
        return float(raw.replace("R$", "").strip().replace(".", "").replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def looks_monetary(raw: str):
    return ("R$" in raw) or raw.endswith(tuple([",00", ",01", ",02", ",03", ",04", ",05", ",06", ",07", ",08", ",09"])) or bool(re.search(r"\d{2,}[.\s]\d{2}$", raw))


def is_junk_value_context(line: str, match_index: int, match_text: str):
    around = line[max(0, match_index - 4): match_index + len(match_text) + 4]
    if CPF_RE.search(around) or CNPJ_RE.search(around) or PROC_RE.search(around) or DATA_RE.search(around):
        return True
    after = line[match_index + len(match_text): match_index + len(match_text) + 2]
    return bool(re.match(r"^\s*%", after))


def page_has_value_above_minimum(text: str, min_value: float):
    for line in text.splitlines():
        for match in VALUE_RE.finditer(line):
            raw = match.group(0).strip()
            if not looks_monetary(raw):
                continue
            if is_junk_value_context(line, match.start(), raw):
                continue
            value = normalize_money(raw)
            if value is not None and value >= min_value:
                return True
    return False


def build_page_scope(total_pages: int, params: dict):
    if params.get("pageStart") and params.get("pageEnd"):
        start = max(1, int(params["pageStart"]))
        end = min(total_pages, int(params["pageEnd"]))
        return list(range(start, end + 1))

    percent = float(params.get("percent") or 100)
    count = max(1, round((total_pages * percent) / 100)) if percent < 100 else total_pages
    first_page = max(1, total_pages - count + 1)
    return list(range(first_page, total_pages + 1))


def build_cover_scope(total_pages: int, limit: int = 3):
    return list(range(1, min(total_pages, limit) + 1))


def extract_pages(pdf_path: str, params: dict, target_process: str):
    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)
    cover_numbers = build_cover_scope(total_pages, 3)
    scope = build_page_scope(total_pages, params)
    cache = {}
    candidate_pages = set()
    process_pages = set()

    for page_number in cover_numbers:
        cache[page_number] = reader.pages[page_number - 1].extract_text() or ""

    for page_number in reversed(scope):
        text = reader.pages[page_number - 1].extract_text() or ""
        cache[page_number] = text

        if target_process and target_process in text:
          process_pages.add(page_number)

        if not page_has_value_above_minimum(text, float(params.get("valorMinimo") or 0)):
            continue

        for nearby in range(page_number - 1, page_number + 2):
            if 1 <= nearby <= total_pages:
                candidate_pages.add(nearby)

    if not candidate_pages and process_pages:
        for page_number in process_pages:
            for nearby in range(page_number - 1, page_number + 2):
                if 1 <= nearby <= total_pages:
                    candidate_pages.add(nearby)

    if not candidate_pages:
        candidate_pages.update(scope)

    value_numbers = sorted(candidate_pages)
    cover_pages = [{"page": page_number, "text": cache.get(page_number, reader.pages[page_number - 1].extract_text() or "")} for page_number in cover_numbers]
    value_pages = [{"page": page_number, "text": cache.get(page_number, reader.pages[page_number - 1].extract_text() or "")} for page_number in value_numbers]

    return {
        "totalPages": total_pages,
        "coverPages": cover_pages,
        "valuePages": value_pages,
    }


def main():
    pdf_path = sys.argv[1]
    params = json.loads(sys.argv[2])
    target_process = sys.argv[3] if len(sys.argv) > 3 else ""
    payload = extract_pages(pdf_path, params, target_process)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
