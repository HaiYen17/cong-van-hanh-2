// Lời chào ngẫu nhiên ở header (học từ DASHBOARD_GREETING_MESSAGES bản Hành chính cũ).
const GREETINGS = [
  "Chúc bạn một ngày làm việc thật năng lượng.",
  "Xin chào, chúc bạn hôm nay mọi việc sẽ suôn sẻ nhé.",
  "Hôm nay mình xử lý từng việc một, chắc tay và thật gọn nhé.",
  "Chúc bạn giữ được nhịp làm việc nhẹ nhàng mà hiệu quả.",
  "Một ngày mới bắt đầu rồi, chúc bạn gặp toàn việc thuận lợi.",
  "Cứ bình tĩnh làm tốt từng phần, hôm nay sẽ rất ổn.",
  "Chúc bạn có một ngày nhiều năng lượng và ít việc phát sinh.",
  "Xin chào, mong hôm nay của bạn mượt như một quy trình đã tối ưu.",
];

export function getGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}
