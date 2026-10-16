import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

import { requireServerEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getDb() {
  if (!globalForPrisma.prisma) {
    // Cloud SQL Auth Proxy cắt kết nối nhàn rỗi → cấu hình pool để KHÔNG giữ
    // kết nối chết: idle timeout ngắn (pool tự đóng trước khi server cắt) +
    // keepAlive (giữ kết nối đang dùng). Tránh lỗi P1017 "Server has closed the connection".
    const adapter = new PrismaPg({
      allowExitOnIdle: true,
      connectionString: requireServerEnv("DATABASE_URL"),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      max: 5,
    });

    globalForPrisma.prisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.prisma;
}
