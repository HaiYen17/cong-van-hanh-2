# Product Blueprint - Cong van hanh

Tai lieu nay ghi lai cac quyet dinh san pham cot loi cho du an V3. Khi mo thread moi, neu task co lien quan nghiep vu, phan quyen, module, database hoac UI flow, Codex phai doc file nay cung voi `CODEX_WORKING_GUIDE.md`.

## Ten san pham

| Muc | Gia tri |
|---|---|
| Ten hien thi | Cong van hanh |
| Ten noi bo folder | Hanh chinh v3 |
| Dinh huong | Tu cong Hanh chinh ban dau mo rong thanh cong van hanh noi bo cho cong ty |

Ghi chu: UI that co the hien thi ten co dau la "Cong van hanh" hoac "Cong Van Hanh" tuy chuan thiet ke sau nay. Neu dung tieng Viet co dau trong code/UI, phai dam bao encoding on dinh.

## Nhom nguoi dung

| Nhom | Mo ta | Ghi chu phan quyen |
|---|---|---|
| Admin | Nguoi xu ly/cau hinh/nghiep vu tung mang | Co quyen cao theo module, khong mac dinh co quyen super admin |
| BOD | Ban dieu hanh/lanh dao | Uu tien view tong quan, phe duyet, bao cao, lich su |
| Nhan vien thuong | Bao gom kho, xuong, van phong | Gui yeu cau, theo doi trang thai, xem lich su lien quan |
| Khach | Nguoi ngoai cong ty trong tuong lai | Chua lam o giai doan dau; thiet ke auth/role khong dong cua kha nang nay |

## Muc tieu trai nghiem

App phai uu tien dong thoi:

- Nhanh: load muot, danh sach lon co phan trang/loc/tim kiem, khong keo toan bo du lieu khong can.
- Dep: giao dien noi bo chuyen nghiep, dong bo nhan dien, khong chap va.
- De tiep can: nhan vien thuong biet bam o dau, admin thay viec can xu ly, BOD xem duoc tong quan.
- Dong bo font: toan bo UI dung `Be Vietnam Pro` de tranh loi font va giu tieng Viet on dinh.

## Typography

| Muc | Quyet dinh |
|---|---|
| Font chinh | Be Vietnam Pro |
| Pham vi | Toan bo UI, dashboard, modal, form, table, report view |
| Cach cau hinh | Khai bao mot lan o root/global theme; module khong tu import/dinh nghia font rieng |
| Fallback | Chi dung font he thong sau `Be Vietnam Pro` khi font chinh chua tai |

Khi scaffold app, uu tien `next/font/google` neu deploy cho phep. Neu moi truong cong ty chan Google Fonts hoac can on dinh noi bo, chuyen sang self-host `Be Vietnam Pro`.

## Pham vi uu tien

| Thu tu | Mang | Ly do |
|---|---|---|
| 1 | Hanh chinh | La nen ban dau va ly do chinh xay he thong |
| 2 | Cau hinh he thong / phan quyen | Phai tach ro truoc khi app lon hon |
| 3 | Kho | Dang roi, nen lam sau khi co nen module/data/permission chuan |
| 4 | Xuong | Dang roi, nen lam sau Kho hoac lam tung vertical slice nho |
| 5 | Khach/portal ngoai | Chi mo rong sau khi core noi bo on dinh |

## Workflow mac dinh

Workflow chuan cho cac module co yeu cau/xu ly:

```text
Nhan vien gui yeu cau -> Admin xu ly -> Truong bo phan/BOD duyet neu can -> Thong bao -> Lich su
```

Bat ky module nao di theo workflow nay phai tra loi truoc:

| Cau hoi | Bat buoc tra loi |
|---|---|
| Ai tao yeu cau? | Nhom user nao duoc tao |
| Ai xu ly? | Admin/module owner nao nhan viec |
| Co can duyet khong? | Khong / truong bo phan / BOD / nhieu cap |
| Thong bao cho ai? | Nguoi tao, admin, nguoi duyet, nhom lien quan |
| Lich su luu gi? | Trang thai, nguoi thao tac, thoi gian, ghi chu, file |

## Du lieu xuong song

Hai nguon du lieu cot loi dau tien:

| Du lieu | Vai tro | Yeu cau |
|---|---|---|
| Danh sach nhan vien | Nguon dinh danh nguoi dung, phan quyen, workflow | Can khoa on dinh, trang thai active/inactive, phong ban/chuc vu neu co |
| Danh sach cong ty | Nguon cau hinh cong ty/phap nhan/doi tac lien quan ho so | Can ma/ten cong ty on dinh, trang thai active/inactive |

Chi chuyen du lieu cu con dung. Du lieu cu khong con dung thi archive/de trong file backup, khong dua vao core V3 neu khong can.

## Quy tac xoa du lieu

Xoa du lieu la thao tac cuc nhay cam.

Mac dinh V3 khong hard delete du lieu nghiep vu. Uu tien:

- `archive`
- `inactive`
- `soft delete`
- `void/cancel`
- audit log day du

Hard delete chi duoc phep khi:

- du lieu la ban nhap/test ro rang, hoac
- co quyen admin dac biet, va
- co confirm ro rang, va
- co log nguoi xoa/thoi gian/ly do.

## Auth va tai khoan

Giai doan dau dung tai khoan/mat khau noi bo.

Yeu cau toi thieu:

- Mat khau khong luu plain text.
- Co role/permission theo module.
- Co trang thai user active/inactive.
- Co audit log cho dang nhap va thao tac quan trong neu kha thi.
- Thiet ke khong dong cua kha nang sau nay them SSO/tai khoan cong ty/khach ngoai.

## Phan quyen V3

V3 ke thua tinh than phan quyen tu folder `Hanh chinh` cu, nhung chuyen sang
Postgres/Prisma va UI moi. Tai lieu chi tiet nam o
`docs/permissions-foundation.md`.

Quyet dinh ban dau:

| Role | Muc dich | Ghi chu |
|---|---|---|
| `super-admin` | Chu he thong, quan ly cau truc quyen | Tach rieng voi Admin thuong; thao tac nhay cam can xac nhan mat khau |
| `admin` | Admin Hanh chinh/module owner | Xu ly yeu cau va cau hinh module, khong mac dinh co quyen Super Admin |
| `bod` | Lanh dao phe duyet/xem tong quan | Xem, duyet, xem lich su; khong sua cau hinh mac dinh |
| `employee` | Nhan vien noi bo | Tao va theo doi yeu cau cua minh |

Role phai duoc cau tao theo `rank`, `module group`, `module rieng`,
`active/inactive`, `isCore`, va audit fields. He thong luon phai giu it nhat
mot Super Admin active.

## Tach bach Cau hinh va Thuc thi

Day la quy tac kien truc quan trong cua V3.

| Nhom | Y nghia | Vi du |
|---|---|---|
| Cau hinh | Noi admin dinh nghia du lieu nen, danh muc, quy tac, quyen, mau bieu, module setting | Danh sach cong ty, danh muc nhan vien, loai ho so, workflow step, phan quyen, mau bieu |
| Thuc thi | Noi user/admin tao va xu ly cong viec hang ngay | Gui yeu cau, xu ly don, duyet, cap so, upload file, theo doi trang thai |

Quy tac:

- Khong tron form cau hinh vao man hinh thuc thi neu khong that su can.
- Man hinh thuc thi chi nen dung du lieu da cau hinh san.
- Thay doi cau hinh co the anh huong module thuc thi thi phai co canh bao.
- Cau hinh can lich su/audit neu tac dong den quy trinh, quyen, danh muc quan trong.
- Module moi phai noi ro phan nao la cau hinh, phan nao la thuc thi truoc khi code.

## Bo cau hoi bat buoc truoc moi module

Truoc khi build mot module lon, Codex phai hoi hoac tu lap bang tra loi:

| Nhom | Cau hoi |
|---|---|
| Muc tieu | Module nay giai quyet viec gi? Ai dung hang ngay? |
| Pham vi | Dau vao, dau ra, trang thai xu ly gom gi? |
| Cau hinh | Danh muc/quy tac/quyen nao can cau hinh truoc? |
| Thuc thi | User tao/xu ly/duyet/theo doi ra sao? |
| Du lieu | Bang Postgres nao can co? Du lieu cu co can import khong? |
| Quyen | Ai xem/tao/sua/duyet/huy/archive/xuat bao cao? |
| Xoa | Co duoc xoa khong, hay chi archive/huy? |
| Thong bao | Ai can nhan thong bao o buoc nao? |
| Lich su | Can log nhung thao tac nao? |
| Hoan thanh | Test nghiep vu nao chung minh module da dung? |

## Nguyen tac import du lieu cu

- Chi import du lieu con dung.
- Import phai co mapping ro tu nguon cu sang schema moi.
- Import bang script, khong copy tay tung dong.
- Sau import phai validate so dong, mau du lieu, va cac khoa lien ket.
- Neu du lieu cu roi/khong chuan, tao bang staging hoac file mapping truoc khi dua vao bang chinh.

## Thu tu nen lam sau blueprint

1. Nen mong du an: Git, Next.js, TypeScript, shared UI skeleton, env structure.
2. Auth noi bo va role co ban.
3. Database core: users/employees, companies, roles/permissions, audit log.
4. Module Hanh chinh dau tien theo vertical slice.
5. Rut data con dung tu ban cu.
6. Mo rong cac module Hanh chinh con lai.
7. Sau khi nen chuan, moi tach thread rieng cho Kho va Xuong.
