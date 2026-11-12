# Tiến Hóa Hoang Dã

Game sinh tồn 2D chạy trên trình duyệt (desktop). Bạn chọn một sinh vật ở dạng tiến hóa đầu tiên và **trực tiếp điều khiển nó**: khám phá, tìm thức ăn và nước, chiến đấu hoặc bỏ chạy, nghỉ ngơi, trưởng thành rồi tiến hóa để vào được những vùng nguy hiểm hơn.

Công nghệ: TypeScript + Phaser 3 + Vite. Không có backend, không tài khoản, không API trả phí. Toàn bộ hình ảnh được vẽ bằng Canvas lúc khởi động và âm thanh tổng hợp bằng Web Audio — không có tài nguyên tải từ nguồn ngoài.

## Cài đặt và chạy

Yêu cầu Node.js 18 trở lên.

```bash
npm install        # cài thư viện
npm run dev        # chạy bản phát triển, mở http://localhost:5173
npm run build      # kiểm tra kiểu + đóng gói vào dist/
npm run preview    # chạy thử bản đã đóng gói
npm run typecheck  # chỉ kiểm tra kiểu TypeScript
npm test           # chạy kiểm thử logic (Vitest)
```

## Điều khiển

| Phím | Hành động |
| --- | --- |
| WASD / phím mũi tên | Di chuyển |
| Shift (giữ) | Chạy nhanh (tốn thể lực) |
| Chuột trái | Đòn cơ bản về hướng con trỏ |
| Q / R / T | Chiêu thức trong 3 ô (ô T mở từ dạng 2; gắn chiêu trong bảng Tab) |
| Space | Né tránh (có hồi chiêu) · hủy tiến hóa |
| E | Ăn / uống / nhặt / tương tác theo ngữ cảnh |
| F | Nằm nghỉ — ngủ khi đủ mệt; ngủ trong nơi trú ẩn an toàn hơn |
| 1–6 | Ăn đồ trong túi |
| M | Đặt/xóa dấu bản đồ (sau khi mua ở Đền Cổ) |
| Tab | Bảng nhân vật & điều kiện tiến hóa |
| Esc | Tạm dừng · cài đặt âm thanh · lưu · thoát |

### Điện thoại / máy tính bảng

Nút cảm ứng tự hiện trên thiết bị màn hình cảm ứng (hoặc thêm `?touch` vào URL để bật thủ công). Chơi được cả khi cầm dọc lẫn cầm ngang, giao diện tự sắp xếp lại khi xoay máy.

- Cần điều khiển ảo (nửa trái màn hình): di chuyển.
- **Đánh**: giữ để đánh liên tục, tự nhắm con gần nhất; chạm vào bản đồ để đánh về hướng đó.
- Nút chiêu Q/R/T, **Né**, **Chạy** (bật/tắt), **Dùng** (tương tác), **Nghỉ**.
- Chạm ô trong túi để ăn; chạm khung gợi ý tương tác để thực hiện.
- Hàng nút trên cùng: **Nhân vật**, **Dấu** (khi đã mở khóa), toàn màn hình, tạm dừng.

Âm thanh chỉ bắt đầu sau lần bấm/nhấn phím đầu tiên (quy định của trình duyệt).

## Vòng chơi

1. **Chọn sinh vật** — Mộc (ăn cỏ, bền bỉ), Hỏa (ăn thịt, săn mạnh nhưng đói nhanh), Thủy (ăn tạp, cân bằng). Mỗi loài có 3 dạng.
2. **Sinh tồn** — Máu, Độ no, Nước, Thể lực, Mệt mỏi giảm theo thời gian mô phỏng. Hết no/nước sẽ mất máu từ từ. Chỉ thức ăn hợp chế độ ăn mới hiện lời nhắc ăn; chỉ uống được khi đứng sát bờ nước.
3. **Chiến đấu & cấp độ** — EXP từ hạ gục sinh vật, khám phá khu vực/quần xã mới và mốc sinh tồn. Đòn nặng của kẻ địch có cảnh báo trước.
4. **Trưởng thành** — Thanh trưởng thành riêng, tăng nhờ ăn uống, sống qua ngày, khám phá và chiến đấu ngang sức (có giảm dần và giới hạn).
5. **Tiến hóa** — Cần đầy thanh trưởng thành, đủ cấp (5 rồi 10), no & nước ≥ 50%, không chiến đấu và đang ở nơi trú ẩn. Lên dạng 3 còn cần **hạ gục 1 sinh vật Tinh anh ★**. Mở bằng Tab, xác nhận, chờ 20 giây (dạng 2) / 40 giây (dạng 3). Bị tấn công sẽ ngắt quá trình nhưng giữ nguyên thanh trưởng thành.
6. **Tiền xu & Đền Cổ** — Nhặt xu, chạm Đá khám phá và hoàn thành thử thách để có xu; tiêu ở Đền Cổ cho túi mang thêm, màu ngoại hình và dấu bản đồ.

Dạng 2 trở lên có thể leo vách đá để lên cao nguyên đá, nơi có kẻ thù mạnh nhất.

### Chiêu thức

- Mỗi loài có **5 dòng chiêu**, học dần qua cấp độ, thành tích sinh tồn (sống qua ngày, hạ gục, uống nước…) và tiến hóa. Bảng Tab hiện điều kiện mở khóa kèm tiến độ.
- Có 3 ô chiêu Q/R/T; chiêu mới tự gắn vào ô trống, có thể đổi ô trong bảng Tab. Hồi chiêu gắn theo từng chiêu nên đổi ô không làm mới hồi chiêu.
- **Thành thạo**: mỗi lần chiêu trúng địch (hoặc mỗi lần dùng chiêu tăng cường) tăng thành thạo. Đủ thành thạo, chiêu **tiến hóa** thành bản mạnh hơn (một số chiêu cần đạt dạng 3).
- Hiệu ứng trạng thái: 🔥 Bỏng và ☠ Độc (mất máu theo thời gian, độc chặn hồi máu), 🐌 Chậm, 💫 Choáng. Chúa tể và Tinh anh kháng một phần choáng/chậm.

### Độ khó

- Đói/khát nhanh hơn, hồi máu tự nhiên chậm hơn, kẻ địch đông hơn và hung hăng hơn.
- **Vùng nguy hiểm**: càng xa điểm xuất phát, sinh vật càng mạnh (máu, sức mạnh, phòng thủ, cấp), và mỗi ngày sống sót chúng lại mạnh thêm một chút.
- **Tinh anh ★** với một thuộc tính đặc biệt (Hung Bạo, Giáp Đá, Kịch Độc, Hỏa Ngục, Hút Máu): mạnh hơn hẳn, không bỏ chạy, thưởng nhiều EXP và xu.
- Thú đi theo **bầy** và báo động cho đồng loại; một số loài **đánh tầm xa** và giữ khoảng cách.
- **Trăng Máu** mỗi 4 đêm: thú dữ mạnh hơn, phát hiện xa hơn, đông hơn. Sống sót tới sáng được gấp đôi EXP ngày và thêm xu.
- Chúa tể **nổi điên** khi còn dưới 50% máu.

### Bản đồ

- Bản đồ 260×260 ô (trước là 180×180) với 5 quần xã: Đồng cỏ, Rừng, Hồ, Đá và **Đầm lầy** mới.
- Đầm lầy làm chậm di chuyển (trừ loài hệ Thủy), nước đầm gây độc cho loài không phải hệ Thủy, có Ếch Độc, Cá Sấu Bùn và chúa tể **Thủy Xà Vương**.
- Thêm ao, nơi trú ẩn, Đá khám phá, xu và các loài mới: Nhím Gai, Linh Miêu Đêm, Gấu Rừng Già, Bọ Cạp Đá.

### Vùng đất & Boss Giữ Cổng

Mỗi lượt chơi đi qua 5 vùng đất, mỗi vùng có bản đồ riêng (cùng seed nhưng địa hình khác), màu không khí riêng, và sinh vật mạnh dần:

| # | Vùng đất | Địa hình | Boss Giữ Cổng |
|---|---|---|---|
| 1 | Thung Lũng Khởi Nguyên | Cân bằng | Mộc Thần Cổ Thụ (cấp 18) |
| 2 | Rừng Sương Mù | Rừng phủ kín | Sương Lang Vương (cấp 26) |
| 3 | Đầm Lầy Hắc Ám | Đầm lầy rộng | Hắc Ngạc Chúa (cấp 34) |
| 4 | Cao Nguyên Hỏa Ngục | Vùng đá và cao nguyên lớn | Hỏa Long Nham Đế (cấp 42) |
| 5 | Vực Hư Không | Hỗn hợp | Hư Không Thần Thú (cấp 50) |

- **Cổng Cổ** nằm xa điểm xuất phát (ô tím trên bản đồ nhỏ). Khi đã tiến hóa tới **dạng cuối**, tương tác với cổng để triệu hồi Boss Giữ Cổng.
- Hạ boss: nhận xu và mở cổng. Bước qua cổng để sang vùng đất tiếp theo, giữ nguyên cấp độ, dạng, chiêu thức, túi đồ và xu, nhận vĩnh viễn +15% máu, +12% sức mạnh, +10% phòng thủ mỗi cổng.
- Vùng đất càng sau, sinh vật càng nhiều máu, sức mạnh, phòng thủ, cấp độ và tỉ lệ Tinh anh, nhưng cũng cho nhiều EXP hơn.
- Hạ Hư Không Thần Thú ở vùng thứ 5 là chiến thắng; có thể tiếp tục khám phá sau đó.

## Lưu game

- Tự động lưu mỗi 45 giây, khi tiến hóa thành công, khi mua đồ, khi chạm Đá khám phá và khi đóng trang.
- Bản lưu nằm trong `localStorage` (khóa `tien-hoa-hoang-da.save`) và có số phiên bản; bản lưu hỏng sẽ hiện thông báo rõ ràng ở menu.
- Thế giới được tạo lại từ seed, chỉ những thay đổi quan trọng (xu đã nhặt, đá đã dùng, tài nguyên đang mọc lại…) được lưu.
- Khi sinh vật chết, bản lưu bị xóa và bạn có thể bắt đầu lượt mới.

## Chế độ debug

Mở game với `?debug=1` (ví dụ `http://localhost:5173/?debug=1`). Mặc định tắt.

- F6: hiện hitbox · F7: bất tử · F8: đủ điều kiện tiến hóa ngay (kể cả thử thách Tinh anh; dịch tới nơi trú ẩn gần nhất) · F9: tua nhanh 3 giờ.
- Bảng thông tin FPS, seed, vị trí, số lượng NPC.

## Cấu trúc mã nguồn

```
src/
  config/balance.ts   Mọi tham số cân bằng (tốc độ đói khát, EXP, tiến hóa, NPC, tài nguyên…)
  data/               Định nghĩa loài, kỹ năng, NPC, thức ăn, cửa hàng, thử thách (data-driven)
  core/               RNG có seed, noise, lưới không gian, tiện ích toán
  world/              Sinh bản đồ theo seed, va chạm, kiểm tra điểm xuất phát
  systems/            Logic thuần (không phụ thuộc Phaser): sinh tồn, ăn uống, chiến đấu,
                      cấp độ, tiến hóa, ngày đêm/thời tiết, lưu game, âm thanh, cài đặt
  gfx/                Vẽ pixel art bằng Canvas: sinh vật, tileset, vật thể, hiệu ứng
  game/               Đối tượng trong game: Player, NPC + AI, CombatSystem, WorldView, ánh sáng, hiệu ứng
  scenes/             BootScene (tạo texture một lần) và GameScene (điều phối)
  ui/                 Giao diện DOM tiếng Việt (menu, HUD, bảng, cửa hàng) và bản đồ nhỏ
tests/                Kiểm thử: chế độ ăn, sát thương & hồi chiêu, tiến hóa, lưu/tải,
                      sinh tồn, khả năng tiếp cận thức ăn/nước từ điểm xuất phát, nhịp độ chơi
```

Muốn thay hình sinh vật bằng tài nguyên khác (ví dụ sprite có bản quyền hợp lệ), sửa phần `art` trong `src/data/species.ts` hoặc thay `ensurePlayerTexture`/`npcTextureKey` trong `src/gfx/textures.ts` — logic game không phụ thuộc vào cách vẽ.
