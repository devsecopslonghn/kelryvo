# Kelryvo

Self-hosted Database DevOps và Governance, ưu tiên Oracle.

Đọc [CHECKLIST.md](CHECKLIST.md) để biết đã làm được gì, giới hạn nghiệm thu,
việc tiếp theo và nơi tra bằng chứng. Đây là nguồn trạng thái duy nhất cho app và Helm.

Engineering checkout cần Node 22.23.3, npm 10.9.9 và Python 3.11+:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run next
```

`npm run check` không cần database; optional cases có thể skip. Product/browser tests
cần PostgreSQL disposable, pinned parser/JDK và Chromium; lệnh cụ thể ở checklist.
Source bundles có các bước cài đặt riêng trong checklist. Local checks không cấp quyền Oracle.

Code: `apps/`, `packages/`. Kiểm chứng: `tests/`, `scripts/`, `.github/workflows/`.
Output tạm nằm trong ignored `.cache/`; giữ license, notices và parser provenance.
