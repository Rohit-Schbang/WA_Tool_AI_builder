const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.connection
  .findMany({ select: { chatbotId: true, phoneNumber: true, phoneNumberId: true, wabaId: true, status: true, accessToken: true, updatedAt: true } })
  .then((rows) => {
    const out = rows.map((c) => ({
      chatbotId: c.chatbotId,
      phoneNumber: c.phoneNumber,
      phoneNumberId: c.phoneNumberId,
      wabaId: c.wabaId,
      status: c.status,
      accessToken: c.accessToken
        ? "len=" + c.accessToken.length + " head=" + c.accessToken.slice(0, 10) + (c.accessToken.startsWith("EAA") ? " (EAA ok)" : " (NOT an EAA token!)")
        : null,
      updatedAt: c.updatedAt,
    }));
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((e) => console.log("ERR " + e.message))
  .finally(() => p.$disconnect());
