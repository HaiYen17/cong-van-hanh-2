import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenHunonicDevices,
  hunonicSign,
} from "./hunonic-mobile-client";

test("hunonicSign keeps the verified mobile signature algorithm stable", () => {
  assert.equal(
    hunonicSign({
      app_name: "hunonic",
      app_role: "1",
      is_pro_app: "0",
      lang: "vi",
      password: "5f4dcc3b5aa765d61d8327deb882cf99",
      phone: "0868123456",
    }),
    "765eb6a4e493aaf6880a330917f0c932",
  );
});

test("flattenHunonicDevices returns safe normalized device records", () => {
  const devices = flattenHunonicDevices([
    {
      id: 12,
      name: "Văn phòng",
      rooms: [
        {
          id: 34,
          name: "Phòng họp",
          devices: [
            {
              id: 56,
              index_in_root: 1,
              name: "Máy lạnh",
              root_id: "HUN-ROOT",
              root_type: "ir",
              state: 1,
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(devices.length, 1);
  assert.deepEqual(
    {
      externalId: devices[0]?.externalId,
      homeName: devices[0]?.homeName,
      name: devices[0]?.name,
      online: devices[0]?.online,
      roomName: devices[0]?.roomName,
      rootType: devices[0]?.rootType,
    },
    {
      externalId: "56",
      homeName: "Văn phòng",
      name: "Máy lạnh",
      online: true,
      roomName: "Phòng họp",
      rootType: "ir",
    },
  );
});
