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
| Q / R | Kỹ năng (R mở khóa từ dạng 2) |
| Space | Né tránh (có hồi chiêu) · hủy tiến hóa |
| E | Ăn / uống / nhặt / tương tác theo ngữ cảnh |
| F | Nằm nghỉ — ngủ khi đủ mệt; ngủ trong nơi trú ẩn an toàn hơn |
| 1–6 | Ăn đồ trong túi |
| M | Đặt/xóa dấu bản đồ (sau khi mua ở Đền Cổ) |
| Tab | Bảng nhân vật & điều kiện tiến hóa |
| Esc | Tạm dừng · cài đặt âm thanh · lưu · thoát |

Âm thanh chỉ bắt đầu sau lần bấm/nhấn phím đầu tiên (quy định của trình duyệt).

## Vòng chơi

1. **Chọn sinh vật** — Mộc (ăn cỏ, bền bỉ), Hỏa (ăn thịt, săn mạnh nhưng đói nhanh), Thủy (ăn tạp, cân bằng). Mỗi loài có 3 dạng.
2. **Sinh tồn** — Máu, Độ no, Nước, Thể lực, Mệt mỏi giảm theo thời gian mô phỏng. Hết no/nước sẽ mất máu từ từ. Chỉ thức ăn hợp chế độ ăn mới hiện lời nhắc ăn; chỉ uống được khi đứng sát bờ nước.
3. **Chiến đấu & cấp độ** — EXP từ hạ gục sinh vật, khám phá khu vực/quần xã mới và mốc sinh tồn. Đòn nặng của kẻ địch có cảnh báo trước.
4. **Trưởng thành** — Thanh trưởng thành riêng, tăng nhờ ăn uống, sống qua ngày, khám phá và chiến đấu ngang sức (có giảm dần và giới hạn).
5. **Tiến hóa** — Cần đầy thanh trưởng thành, đủ cấp (5 rồi 10), no & nước ≥ 50%, không chiến đấu và đang ở nơi trú ẩn. Mở bằng Tab, xác nhận, chờ 20 giây (dạng 2) / 40 giây (dạng 3). Bị tấn công sẽ ngắt quá trình nhưng giữ nguyên thanh trưởng thành.
6. **Tiền xu & Đền Cổ** — Nhặt xu, chạm Đá khám phá và hoàn thành thử thách để có xu; tiêu ở Đền Cổ cho túi mang thêm, màu ngoại hình và dấu bản đồ.

Dạng 2 trở lên có thể leo vách đá để lên cao nguyên đá, nơi có kẻ thù mạnh nhất.

## Lưu game

- Tự động lưu mỗi 45 giây, khi tiến hóa thành công, khi mua đồ, khi chạm Đá khám phá và khi đóng trang.
- Bản lưu nằm trong `localStorage` (khóa `tien-hoa-hoang-da.save`) và có số phiên bản; bản lưu hỏng sẽ hiện thông báo rõ ràng ở menu.
- Thế giới được tạo lại từ seed, chỉ những thay đổi quan trọng (xu đã nhặt, đá đã dùng, tài nguyên đang mọc lại…) được lưu.
- Khi sinh vật chết, bản lưu bị xóa và bạn có thể bắt đầu lượt mới.

## Chế độ debug

Mở game với `?debug=1` (ví dụ `http://localhost:5173/?debug=1`). Mặc định tắt.

- F6: hiện hitbox · F7: bất tử · F8: đủ điều kiện tiến hóa ngay (dịch tới nơi trú ẩn gần nhất) · F9: tua nhanh 3 giờ.
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
