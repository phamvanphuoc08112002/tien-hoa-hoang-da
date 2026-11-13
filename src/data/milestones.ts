export interface MilestoneDef {
  id: string;
  name: string;
  desc: string;
  exp: number;
  coins: number;
  maturity: number;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'first_meal', name: 'Bữa ăn đầu tiên', desc: 'Ăn một món phù hợp.', exp: 10, coins: 2, maturity: 2 },
  { id: 'first_drink', name: 'Ngụm nước đầu tiên', desc: 'Uống nước ở hồ hoặc suối.', exp: 10, coins: 2, maturity: 2 },
  { id: 'first_kill', name: 'Chiến thắng đầu tiên', desc: 'Hạ gục một sinh vật.', exp: 15, coins: 3, maturity: 3 },
  { id: 'safe_sleep', name: 'Giấc ngủ an toàn', desc: 'Ngủ trong nơi trú ẩn.', exp: 15, coins: 3, maturity: 3 },
  { id: 'all_biomes', name: 'Nhà thám hiểm', desc: 'Đặt chân tới cả 5 vùng.', exp: 50, coins: 10, maturity: 5 },
  { id: 'elite_1', name: 'Săn Tinh anh', desc: 'Hạ gục một sinh vật Tinh anh ★.', exp: 30, coins: 6, maturity: 4 },
  { id: 'skill_evolve', name: 'Chiêu thức thăng hoa', desc: 'Tiến hóa một chiêu thức nhờ luyện tập.', exp: 25, coins: 5, maturity: 3 },
  { id: 'blood_moon', name: 'Vượt qua Trăng Máu', desc: 'Sống sót qua một đêm Trăng Máu.', exp: 60, coins: 12, maturity: 6 },
  { id: 'swamp_boss', name: 'Hạ bệ Thủy Xà Vương', desc: 'Đánh bại chúa tể đầm lầy.', exp: 0, coins: 35, maturity: 0 },
  { id: 'hunter_10', name: 'Thợ săn lão luyện', desc: 'Hạ gục 10 sinh vật.', exp: 50, coins: 8, maturity: 4 },
  { id: 'day_3', name: 'Kẻ sống sót', desc: 'Sống sót qua 3 bình minh.', exp: 60, coins: 10, maturity: 5 },
  { id: 'evolve_1', name: 'Lột xác', desc: 'Tiến hóa lần đầu.', exp: 0, coins: 10, maturity: 0 },
  { id: 'evolve_2', name: 'Dạng thứ ba', desc: 'Đạt dạng tiến hóa thứ ba — đủ sức mở Cổng Cổ.', exp: 0, coins: 20, maturity: 0 },
  { id: 'evolve_3', name: 'Hình thái khủng bố', desc: 'Đạt dạng thứ tư — hào quang bao quanh.', exp: 40, coins: 30, maturity: 0 },
  { id: 'evolve_4', name: 'Thần thoại sống', desc: 'Đạt dạng thứ năm tối thượng.', exp: 80, coins: 50, maturity: 0 },
  { id: 'alpha', name: 'Hạ bệ Nham Chúa', desc: 'Đánh bại thủ lĩnh cao nguyên đá.', exp: 0, coins: 30, maturity: 0 },
];

export const MILESTONE_MAP: Record<string, MilestoneDef> = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
