# Codex Working Guide - Hanh chinh v3

Muc dich cua file nay: giu cung mot cach lam viec giua cac thread, tranh roi context, tranh lap lai vong lap cu, va luon tach bach viec nao user lam thu cong voi viec nao Codex se lam.

## Quy tac dau moi thread

Khi bat dau mot thread moi trong du an nay, Codex phai doc file nay truoc khi lam viec. Neu user quen, Codex nen tu nhac:

```text
Tui se doc CODEX_WORKING_GUIDE.md truoc de giu dung cach lam viec cua du an.
```

Neu thread co lien quan den nghiep vu, module, phan quyen, database, UI flow, import du lieu cu, hoac kien truc san pham, Codex phai doc them:

```text
docs/product-blueprint.md
```

Luu y ve cach hop tac: user khong chuyen sau ky thuat. Codex phai giai thich ngan gon bang ngon ngu de hieu, chu dong lam nhung viec co the lam tren may, va luon noi ro viec nao user phai lam thu cong.

## Bang huong dan lam viec

| Tinh huong | Viec Codex phai lam | Viec user lam thu cong | Khi nao nen tach thread | Ket qua bat buoc |
|---|---|---|---|---|
| Bat dau thread moi | Doc file nay, scan folder lien quan, tom tat muc tieu hien tai | Noi ro thread nay dang lam buoc nao neu co | Khong can neu chi tiep tuc 1 viec nho | Codex noi lai: dang o dau, sap lam gi |
| Can thong tin ky thuat ngoai workspace | Noi ro can thong tin gi, vi sao can, cach lay | Lay thong tin tu GitHub, Vercel, Postgres, IT, email, tai khoan | Co, neu buoc thu cong dai hoac lien quan tai khoan/quyen | Checklist "Viec user can lam thu cong" va "Viec Codex lam sau do" |
| Lam Git/repo | Thiet lap .gitignore, cau truc repo, huong dan commit, khong commit secret | Tao GitHub repo/private repo neu Codex khong co quyen | Nen tach neu dang chuyen tu setup local sang GitHub/deploy | Repo sach, co lich su thay doi ro |
| Lam database Postgres | Thiet ke schema, migration, seed/import script, dung dev/staging truoc production | Cap connection string, tao database/user rieng, xin quyen IT | Nen tach rieng thanh thread Database Schema | Co migration, khong sua production truc tiep |
| Lam auth/phan quyen | De xuat vai tro, viet logic kiem tra quyen, test cac role | Xac nhan ai duoc xem/sua/xoa theo nghiep vu cong ty | Nen tach rieng neu co nhieu role/phong ban | Bang permission ro rang va test duoc |
| Rut nghiep vu tu ban cu | Doc app/file cu, lap danh sach module, map cot du lieu cu sang schema moi | Giai thich quy trinh cong ty, chon module uu tien | Nen tach thanh thread Rut Nghiep Vu | Co docs/modules.md, docs/permissions.md, docs/data-map.md neu can |
| Rut pattern tu folder `Hanh chinh` cu | Doc `AGENTS.md`, UI standard, shared UI va module dai dien; chi lay quy uoc tot, khong copy loi/ky thuat cu | Noi ro pattern nao user muon giu neu co | Nen tach neu dang lam bo chuan UI/module rieng | Cap nhat guide/docs de V3 khong di lech |
| Lam UI/module tren V3 | Tao module co ranh gioi rieng, dung shared UI/CSS truoc, CSS rieng chi cho nghiep vu/layout dac thu | Test bang mat xem co dung nhan dien he thong cu khong | Nen tach moi thread cho module lon | Module dong bo giao dien, khong tao class trung lap |
| Lam mot module moi | Lam vertical slice: yeu cau -> schema -> backend -> UI -> test -> summary | Test bang mat nghiep vu, noi dung/sua label/quy trinh | Luon nen tach moi thread cho moi module lon | Module chay duoc end-to-end |
| Tach cau hinh va thuc thi | Xac dinh phan nao la setting/danh muc/quy tac, phan nao la thao tac hang ngay | Xac nhan quy trinh cong ty va ai duoc cau hinh | Nen tach neu module co nhieu danh muc/quy tac | Man hinh cau hinh khong bi tron voi man hinh thuc thi |
| Xoa/huy/archive du lieu | Mac dinh thiet ke soft delete/archive/audit log, khong hard delete | Xac nhan du lieu nao that su duoc phep xoa | Nen tach neu lien quan du lieu quan trong | Co confirm, audit log, va chinh sach xoa ro |
| Sau khi xong mot module | Tom tat file da sua, cach test, loi con lai, viec tiep theo | Chon module tiep theo hoac test nghiep vu | Nen de xuat tach thread moi | Co handoff ngan gon cho thread sau |
| Deploy | Chay `npm run check:deploy-modules`, build tu root V3, kiem tra revision/traffic va smoke test Services; rollback neu thieu card/route | Cap tai khoan/quyen ngoai he thong neu can | Nen tach rieng thanh thread Deploy | Link deploy, revision, inventory module da kiem tra, cach rollback, check loi |
| Gap loi lap lai | Dieu tra theo log -> reproduce -> fix nho -> test lai | Cung cap anh man hinh, tai khoan test, buoc gay loi neu co | Nen tach neu loi thuoc module khac | Co nguyen nhan, fix, test, viec con mo |

## Mau Codex phai dung khi co viec thu cong

```text
Viec ong can lam thu cong:
1. ...
2. ...

Viec tui se lam sau khi ong xong:
1. ...
2. ...

Nen tach thread khong:
Co/Khong - ly do ...
```

## Quy tac lam viec voi user khong chuyen ky thuat

| Tinh huong | Cach Codex phai lam |
|---|---|
| Can quyet dinh ky thuat | Dua khuyen nghi mac dinh, giai thich ngan gon loi/hai, tranh dua qua nhieu lua chon cung luc |
| Can user thao tac thu cong | Viet checklist tung buoc, noi vi sao can, noi sau khi xong Codex se lam gi |
| Can tai khoan/quyen/server | Noi ro day la viec user/IT phai lam, khong noi nhu the user phai biet san |
| Gap loi | Tom tat loi bang ngon ngu de hieu, tach viec user can cung cap voi viec Codex tu dieu tra |
| Xong mot buoc/module | Noi da xong gi, test sao, con rui ro gi, va co nen tach thread tiep khong |

Mac dinh Codex nen chu dong thuc hien viec co the lam trong workspace. Chi hoi user khi can thong tin nghiep vu, tai khoan, quyen, secret, connection string, quyet dinh san pham, hoac thao tac ngoai may/ngoai workspace.

## Chuan tach thread

Nen tach thread khi:

- Da xong nen mong du an.
- Chuyen sang rut nghiep vu tu ban cu.
- Chuyen sang thiet ke database.
- Bat dau mot module lon moi.
- Chuyen sang deploy/staging/production.
- Thread da dai, Codex bat dau can nhieu tom tat de nho context.
- Co buoc user phai lam thu cong voi tai khoan, quyen, server, database, billing, hoac IT.

Khong can tach thread khi:

- Chi sua typo, label, mau sac nho.
- Chi sua mot bug nho trong cung module dang lam.
- Chi chay test/build lai sau mot thay doi vua lam.

## Quy tac ky thuat nen giu

### Checklist chống mất module khi deploy

- Không deploy từ `.codex_tmp`, folder snapshot, folder copy hoặc output build cũ.
- `docs/deploy-module-baseline.json` là danh sách card/route tối thiểu phải còn.
- `npm run check:deploy-modules` phải xanh trước deploy và đã được gắn vào
  `prebuild`; lỗi guard nghĩa là dừng deploy để phục hồi module.
- Sau deploy phải ghi nhận revision mới, xác nhận 100% traffic rồi mở Services
  bằng tài khoản full quyền để kiểm tra danh mục. Tối thiểu module `Cấu hình`
  phải còn tab `Hunonic`, và Services phải còn `Điều khiển máy lạnh`.
- Thiếu card/route sau deploy thì rollback revision, không sửa baseline để hợp
  thức hóa lỗi production.

| Mang | Lua chon uu tien | Ghi chu |
|---|---|---|
| Source control | Git + GitHub private repo | Khong commit `.env`, secret, password, connection string |
| App | Next.js + TypeScript | Dung de deploy web app that va co backend trong cung project |
| Database | Postgres cua cong ty | Luon co dev/staging truoc production |
| Schema change | Migration | Khong sua bang truc tiep bang tay neu co the tranh |
| ORM | Prisma mac dinh, Drizzle neu can gan SQL hon | Chon 1 cai va giu nhat quan |
| Deploy | Vercel neu duoc phep, server cong ty neu bat buoc | Moi moi truong co env vars rieng |
| Data cu | Export CSV/Sheet -> import script -> verify | Khong copy tay tung dong |
| Product blueprint | `docs/product-blueprint.md` | La nguon that cho ten app, user group, workflow, data core, auth, quy tac xoa |
| Typography | Be Vietnam Pro | Khai bao mot lan o root/global CSS; moi UI/module phai ke thua font nay |
| Module structure | Moi module co file/folder rieng | Ke thua tinh than `*Modal.html`, `*Repository.js`, `*_api.js` cua ban cu nhung ap dung theo Next.js |
| Shared UI/CSS | Dung shared components/styles truoc | Nut, tieu de, toolbar, form field, modal, toast, badge, table/filter khong viet lai tung module |
| Module CSS | Chi dung cho layout/nghiep vu dac thu | Neu style lap lai 2 lan, dua ve shared CSS/component |

## Quy tac san pham cot loi

Nhung quy tac nay lay tu phong van user va phai duoc uu tien khi thiet ke V3:

| Mang | Quyet dinh |
|---|---|
| Ten san pham | Ten hien thi la `Cong van hanh` |
| Nhom user | Admin, BOD, nhan vien thuong; sau nay co the mo cho khach |
| Uu tien dau | Cac module Hanh chinh la nen dau tien |
| Mang dang roi | Kho va Xuong can lam lai sau khi co nen module/database/permission chuan |
| Workflow mac dinh | Nhan vien gui yeu cau -> admin xu ly -> truong bo phan/BOD duyet neu can -> thong bao -> lich su |
| Du lieu xuong song | Danh sach nhan vien va danh sach cong ty |
| Xoa du lieu | Cuc nhay cam; mac dinh soft delete/archive/inactive/void kem audit log |
| Trai nghiem | Nhanh, dep, de tiep can voi nguoi dung khong chuyen ky thuat |
| Font chu | Toan bo UI dung `Be Vietnam Pro` |
| Du lieu cu | Chi chuyen du lieu con dung |
| Auth | Giai doan dau dung tai khoan/mat khau noi bo |
| Kien truc nghiep vu | Luon tach bach `Cau hinh` va `Thuc thi` |

## Quy tac phan quyen V3

Truoc khi code auth/role/permission, doc:

```text
docs/permissions-foundation.md
```

V3 ke thua cau truc quyen tot tu folder `Hanh chinh` cu:

- Role co `key`, `name/label`, `description`, `rank`, `status`, `isCore`, audit fields.
- Role mo quyen theo ca `module group` va `module` rieng le.
- `Super Admin` tach rieng voi `Admin`; Admin thuong khong mac dinh xem/sua cong cu Super Admin.
- Quan ly phan quyen la thao tac nhay cam, can xac nhan mat khau Super Admin.
- He thong luon phai giu it nhat mot Super Admin active.
- Default employee access phai la bundle/tap quyen dung lai, khong copy tay vao tung role.
- Role inactive/archive giu lich su, khong hard delete mac dinh.

## Quy tac typography

| Hang muc | Quy tac |
|---|---|
| Font mac dinh | Toan bo app phai dung `Be Vietnam Pro` |
| Noi khai bao | Khai bao mot lan tai root layout/global CSS/theme token |
| Module rieng | Khong duoc tu dat font-family khac neu khong co ly do dac biet duoc user dong y |
| Fallback | Chi dung fallback he thong sau `Be Vietnam Pro` de tranh trang loi khi font chua tai |
| Kiem tra UI | Khi verify giao dien, can de y loi font/tieng Viet/ky tu bi lech hoac sai weight |

Khi scaffold Next.js, uu tien cau hinh font bang co che chinh thong cua framework, vi du `next/font/google` hoac self-host neu moi truong deploy khong duoc goi Google Fonts. Tat ca component/shared UI phai ke thua token font chung thay vi import font rieng.

## Quy tac tach Cau hinh va Thuc thi

| Nhom | Nen chua | Khong nen chua |
|---|---|---|
| Cau hinh | Danh muc, quy tac, phan quyen, mau bieu, workflow step, module setting | Don viec hang ngay dang xu ly |
| Thuc thi | Tao yeu cau, xu ly, duyet, cap so, upload file, theo doi trang thai | Form sua danh muc/quy tac nguy hiem neu khong co quyen |

Quy tac bat buoc:

- Module moi phai noi ro phan nao la cau hinh, phan nao la thuc thi truoc khi code.
- Man hinh thuc thi chi nen dung du lieu da cau hinh san.
- Thay doi cau hinh quan trong phai co canh bao va audit log neu kha thi.
- Khong tron cac nut/field cau hinh vao workflow hang ngay neu lam nguoi dung thuong bi roi.
- Neu user yeu cau mot module lon, Codex phai hoi hoac tu lap bang: cau hinh can gi, thuc thi gom gi, ai co quyen tung phan.

## Quy uoc ke thua tu folder `Hanh chinh` cu

Folder cu la nguon tham khao pattern, khong phai nguon de copy toan bo code sang V3. Khi can rut pattern tu ban cu, Codex phai doc dung file lien quan thay vi doan theo tri nho.

| Nhom trong ban cu | File/vi du da thay | Dieu V3 nen giu | Dieu V3 nen doi moi |
|---|---|---|---|
| Module UI rieng | `DongDauModal.html`, `TrichLucModal.html`, `AssetSetupModal.html`, `WorkshopPlanModal.html`, `WarehouseReportModal.html` | Moi nghiep vu lon co file/folder module rieng, khong nhoi tat ca vao mot file | Trong Next.js, tach thanh `src/modules/<module>` hoac component/module route ro rang |
| Backend/repository rieng | `InboxRepository.js`, `EvaluationRepository.js`, `DocumentRegistryRepository.js`, `*_api.js` | Logic data/API cua module co lop rieng, khong tron vao UI | Doi sang service/repository typed, query Postgres qua ORM/migration |
| Shared style chung | `AppStyles.html`, `UiSharedPrimitives.html`, `UiSharedControls.html` | Cac nut, title, toolbar, form, modal, chip, badge, file picker, combobox dung chung | Doi sang `src/components/ui`, `src/styles/globals.css` hoac `src/styles/shared.css` |
| Runtime/shared behavior | `ServiceRuntime.html`, `AppScripts.html`, `InboxShared.html` | Loading, toast, modal open/close, confirm dialog, empty state, helper shared phai tap trung | Doi sang React hooks/components/shared utilities, khong phu thuoc Google Apps Script runtime |
| Lazy-load module | Mapping trong `Code.js`, `AppScripts.html`, `ServiceRuntime.html` | Module nang chi load khi can, dashboard khong nen keo tat ca ngay tu dau | Dung route-level/code-splitting cua Next.js va data fetching co cache/pagination |
| Tai lieu chuan UI | `V2_UI_COMPONENT_STANDARD.md`, `V2_UI_COMPONENT_STANDARD_SUPPLEMENT.md`, `AGENTS.md` | Truoc khi sua UI phai kiem tra primitive/control/pattern da co chua | Dua chuan moi vao docs V3, khong de nam ran rac trong chat |
| File copy/baseline | `* - Copy.*` | Co the doc de tham khao baseline khi can | Khong sua/copy tiep pattern tao nhieu ban trung lap |

## Chuan UI/module cho V3

Codex phai uu tien thiet ke theo 4 lop:

| Lop | Y nghia | Vi du |
|---|---|---|
| Primitive | Element nho lap lai nhieu | Button, icon button, close button, badge, chip, pill |
| Control | Control co hanh vi nhap lieu | Combobox, multi-select, search input, file picker, segmented tabs |
| Pattern | Khoi UI/hanh vi dung lai | Modal shell, form two-panel, loading overlay, confirm dialog, empty state, toolbar |
| Module | Nghiep vu rieng | Cong van, ho so, tai san, yeu cau, inbox, bao cao |

Quy tac bat buoc khi lam UI:

- Neu can nut xac nhan, nut phu, nut dong, tieu de, toolbar, modal, form field, badge/chip, toast/loading, search/filter, file picker: kiem tra shared UI truoc.
- Khong tao class CSS rieng neu chi doi ten nhung hanh vi/hinh dang giong shared UI.
- Module duoc co CSS rieng khi no la layout hoac nghiep vu dac thu, nhung khong duoc lap lai button/form/modal/table style.
- Neu mot style/helper xuat hien o tu 2 module tro len, phai dua ve shared component/style.
- Giao dien V3 nen giu tinh than he thong cu: nen sang, xanh dam, cam nhan, line mong, bong nhe, goc gon; tranh palette moi khong can thiet.
- Toan bo UI phai ke thua font `Be Vietnam Pro`; khong dat font khac trong module-specific CSS.
- Khong long card trong card neu chi la section thuong; chi dung card cho item lap lai, modal, tool frame, hoac khu vuc co ranh gioi chuc nang ro.
- Module moi phai co mobile layout hop ly, khong bat cuon ngang.
- Thao tac cham phai co loading/progress/toast ro, khong chi hien text nho o cuoi man hinh.

## Checklist khi tao module V3

| Buoc | Codex can lam |
|---|---|
| 1 | Doc `CODEX_WORKING_GUIDE.md` va neu can doc pattern tu folder `Hanh chinh` cu |
| 2 | Xac dinh module nay co phai module lon can tach thread rieng khong |
| 3 | Tao ranh gioi module: route/page, components, service/repository, schema/data type |
| 4 | Dung shared UI cho primitive/control/pattern truoc khi them CSS moi |
| 5 | Neu co CSS moi, giai thich vi sao no la module-specific |
| 6 | Neu co backend/data, di qua migration/service/repository, khong hardcode data trong UI |
| 7 | Test build/lint hoac verify UI tuy theo muc do thay doi |
| 8 | Khi xong, tom tat va de xuat co nen tach thread tiep theo khong |

## Definition of Done cho moi module

Mot module chi xem la xong khi co du cac muc sau:

- Co luong nghiep vu ro: ai dung, lam gi, ket qua gi.
- Co database/migration neu can luu du lieu.
- Co UI dung duoc, khong chi la demo tinh.
- Co backend/API/server action neu can.
- Co phan quyen co ban neu du lieu nhay cam.
- Co test/build toi thieu hoac cach verify ro.
- Co tom tat cho user: da lam gi, test sao, con rui ro gi.
- Codex de xuat co nen tach thread tiep theo hay khong.

## Cau user nen paste khi mo thread moi

```text
Doc CODEX_WORKING_GUIDE.md truoc. Day la du an Hanh chinh v3.
Thread nay minh se lam: [ten buoc/module].
Hay noi ro viec nao tui lam thu cong, viec nao ong lam, va khi nao nen tach thread tiep.
Luu y: Tui khong chuyen sau ky thuat, ong hay giai thich ngan gon va chu dong lam nhung gi co the lam trong may.
```
