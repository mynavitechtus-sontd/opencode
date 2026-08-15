---
name: itfs-onboarding
description: Use when a user is new to ITFS, asks for onboarding or profile setup, or their ITFS profile is missing primary role, focus role, or prior level.
---

# ITFS Onboarding

Complete only the missing API-backed profile fields before continuing with ITFS.

## When to use

- When the user mentions onboarding, new, first time, setup, đăng ký, or lần đầu.
- When an ITFS request requires a complete profile.

## Workflow

### Step 1 — Load API profile

1. Call `itfs_get_profile()`.
2. If it fails with `AUTH_EXPIRED`, tell the user: `Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.` Then stop.
3. If it fails with `NETWORK_ERROR`, tell the user: `Không kết nối được máy chủ, vui lòng thử lại sau.` Then stop.
4. For any other error, tell the user that their ITFS profile could not be loaded and stop. Do not use a fallback.
5. Treat onboarding as incomplete when `primary_role`, `focus_role`, or `old_level` is `null` or omitted. If none are missing, skip information collection and continue to Step 5.

### Step 2 — Collect only missing information

Ask only for values whose profile field is missing:

| Missing field | Vietnamese prompt | Canonical API value |
| --- | --- | --- |
| `primary_role` | `Vai trò của bạn trong development team ở các dự án trước đây là gì? (ví dụ: Frontend, Backend, Mobile)` | `frontend` \| `backend` \| `mobile` |
| `focus_role` | `Bạn đang tập trung phát triển thêm mảng nào trong ITFS? (ví dụ: Frontend, Backend, Mobile)` | `frontend` \| `backend` \| `mobile` |
| `old_level` | `Level trước ITFS của bạn là gì? (ví dụ: Junior 3, Senior 1,...)` | `J1`–`S3` key (e.g. `J3`, `M2`, `S1`) |

KHÔNG BAO GIỜ sử dụng các key `J1`–`S3` để giao tiếp với user. Hãy sử dụng tên hoàn chỉnh `Junior 1` - `Senior 3`.

### Step 3 — Validate and normalize

Normalize role inputs case-insensitively: `FE`, `front end`, and `frontend` to `frontend`; `BE`, `back end`, and `backend` to `backend`; and `ios`, `android`, `flutter`, `react native`, and `mobile` to `mobile`.

Chấp nhận tất cả các cách gọi level trong bảng bên dưới (gồm Level names, level keys, aliases); normalize them to the canonical keys (`J1`–`S3`) and pass `old_level` as the key.

| Level name | Level key | Aliases |
|---|---|---|
| Junior 1 | J1 | j1 |
| Junior 2 | J2 | j2 |
| Junior 3 | J3 | j3 |
| Middle 1 | M1 | m1, c1, career 1 |
| Middle 2 | M2 | m2, c2, career 2 |
| Middle 3 | M3 | m3, c3, career 3 |
| Senior 1 | S1 | s1 |
| Senior 2 | S2 | s2 |
| Senior 3 | S3 | s3 |

Reject only the invalid field and re-prompt in Vietnamese.

When both roles are collected or one is collected alongside an existing profile role, require `primary_role != focus_role`.

### Step 4 — Update API profile

Call `itfs_update_profile()` once with only the normalized fields collected in this run. On `VALIDATION_ERROR`, correct only the field named by the error and retry. On authentication, network, or unknown errors, notify the user and stop.

### Step 5 — Complete

Summary lại profile của người dùng và in ra sau đó **Branch based on how onboarding was triggered:**

- **User explicitly asked for onboarding** (keywords: onboarding, new, first time, setup, đăng ký, lần đầu, or user ran the skill directly): notify in Vietnamese that onboarding is complete:

> Đã có đầy đủ thông tin. Bạn muốn được hỗ trợ gì hôm nay?
> - Hỗ trợ verify ITFS level
> - Hỗ trợ tìm điểm yếu để đặt mục tiêu phát triển ITFS (coming soon)
> - Hỗ trợ về các vấn đề liên quan đến ITFS (coming soon)

- **Onboarding was triggered as a prerequisite** (user had another request, but profile fields were missing so onboarding ran first — e.g. user asked "kiểm tra ITFS level của tôi" but had no profile yet): skip the completion message entirely and immediately continue with the user's original request. Do not show the onboarding completion prompt.

## Quick Reference

| Condition | Action |
| --- | --- |
| Profile cannot load | Notify the user and stop |
| Complete profile | Skip collection and continue to Step 5 |
| Missing profile fields | Collect only those fields, normalize, then call `itfs_update_profile` once |
| Validation fails | Re-prompt only the named field |
| Update fails | Notify the user and stop |

## Red Flags — STOP and re-check

- Asking for a value already present in the profile.
- Sending a pre-existing profile field in the `itfs_update_profile` payload.
- Sending unnormalized roles or level values outside the `J1`–`S3` key set.
- Sử dụng `J1` - `S3` key set để giao tiếp thông tin về level với user.
- Allowing `primary_role` and `focus_role` to match.
- Continuing to Step 5 after an unsuccessful `itfs_update_profile` call.

**All of these mean: Go back to the correct step and follow the exact workflow.**
