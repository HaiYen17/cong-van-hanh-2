import "dotenv/config";

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const now = () => new Date();
const gid = (p) => `${p}_${randomUUID()}`;
const thumb = (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w1200`;

const reactionSet = {
  key: "react-message",
  name: "React thông điệp",
  options: [
    { label: "Mặt cười", value: "smile", symbol: "😊", tone: "emerald" },
    { label: "Yêu thích", value: "love", symbol: "❤️", tone: "rose" },
    { label: "Mạnh mẽ", value: "strong", symbol: "💪", tone: "amber" },
    { label: "Tuyệt", value: "cool", symbol: "😎", tone: "sky" },
  ],
};

const events = JSON.parse(
  readFileSync(new URL("./motivation-seed.json", import.meta.url), "utf8"),
);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const rs = await client.query(
      `
        INSERT INTO "ReactionSet" ("id", "key", "name", "options", "status", "updatedAt")
        VALUES ($1, $2, $3, $4::jsonb, 'ACTIVE'::"MotivationStatus", $5)
        ON CONFLICT ("key") DO UPDATE SET
          "name" = EXCLUDED."name",
          "options" = EXCLUDED."options",
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "id"
      `,
      [gid("rs"), reactionSet.key, reactionSet.name, JSON.stringify(reactionSet.options), now()],
    );
    const reactionSetId = rs.rows[0].id;

    // Seed lại sạch (dev): xoá reaction + event cũ rồi nạp full bản tin (giữ markup màu/đậm).
    await client.query('DELETE FROM "MotivationReaction"');
    await client.query('DELETE FROM "MotivationEvent"');

    let priority = events.length;
    for (const e of events) {
      await client.query(
        `
          INSERT INTO "MotivationEvent"
            ("id", "kind", "title", "body", "imageUrl", "imageId", "priority", "saveResponse", "status", "reactionSetId", "updatedAt")
          VALUES ($1, 'message', $2, $3, $4, $5, $6, true, 'ACTIVE'::"MotivationStatus", $7, $8)
        `,
        [gid("mev"), e.title, e.body || null, thumb(e.imageId), e.imageId, priority, reactionSetId, now()],
      );
      priority -= 1;
    }

    // 1 thông báo test (kind=notification) để kiểm tra chuyển qua lại với thông điệp.
    await client.query(
      `
        INSERT INTO "MotivationEvent"
          ("id", "kind", "title", "body", "imageUrl", "imageId", "priority", "saveResponse", "status", "reactionSetId", "updatedAt")
        VALUES ($1, 'notice', $2, $3, $4, $5, $6, false, 'ACTIVE'::"MotivationStatus", NULL, $7)
      `,
      [
        gid("mev"),
        "Lịch đồng bộ dữ liệu kho lúc 16:30",
        "Hệ thống sẽ tự đồng bộ dữ liệu Eshop và ViettelPost lúc 16:30 hôm nay. Vui lòng không tắt thiết bị quét trong khung giờ này để tránh thiếu dữ liệu.",
        thumb("1OibV-t_Kt766lcJEPYTnaP5N7HTX5eBC"),
        "1OibV-t_Kt766lcJEPYTnaP5N7HTX5eBC",
        100,
        now(),
      ],
    );

    await client.query("COMMIT");
    console.log(`ReactionSet ok. Messages: ${events.length}, + 1 notification.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
