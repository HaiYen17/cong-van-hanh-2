import assert from "node:assert/strict";
import test from "node:test";
import { appendEvaluationResultPdf, evaluationMailRequiresResultPdf, processEvaluationMailOutbox } from "./mail-delivery";

const result = { content: Buffer.from("%PDF-1.7\nresult"), contentType: "application/pdf", fileName: "Ket-qua.pdf" };
test("mail trả kết quả luôn có PDF ngay cả khi chưa chọn biểu mẫu bổ sung", async () => {
  for (const event of ["cnb_result_finalized", "evaluation_completed"]) {
    assert.equal(evaluationMailRequiresResultPdf(event), true);
    assert.deepEqual(await appendEvaluationResultPdf(event, [], async () => result), [result]);
  }
});
test("giữ nguyên các biểu mẫu tùy chỉnh, không thay thế bằng phiếu kết quả", async () => {
  const contract = { ...result, fileName: "Hop-dong.pdf" };
  assert.deepEqual(await appendEvaluationResultPdf("cnb_result_finalized", [contract], async () => result), [result, contract]);
});
test("mail nhắc việc không tạo phiếu kết quả chưa hoàn tất", async () => {
  assert.deepEqual(await appendEvaluationResultPdf("review_assigned", [], async () => { throw new Error("Không được gọi"); }), []);
});
test("lỗi tạo PDF phải chặn gửi email thiếu tệp", async () => {
  await assert.rejects(appendEvaluationResultPdf("cnb_result_finalized", [], async () => { throw new Error("PDF failed"); }), /PDF failed/);
  await assert.rejects(appendEvaluationResultPdf("cnb_result_finalized", [], async () => ({ ...result, content: Buffer.from("not a PDF") })), /Email chưa được gửi/);
});

test("danh sách gửi rỗng không được quét hoặc gửi các email ngoài phạm vi", async () => {
  assert.deepEqual(await processEvaluationMailOutbox({ ids: [] }), { cancelled: 0, failed: 0, processed: 0, sent: 0 });
});
