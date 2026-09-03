async function get(ctx, type) {
    try {
        let title = "";
        let items = [];

        switch (type) {
            case "alkitab": {
                title = "𝑫𝒂𝒇𝒕𝒂𝒓 𝑲𝒊𝒕𝒂𝒃";
                const data = (await ctx.request.get("https://api-alkitab.vercel.app/api/book")).data.data;
                items = data.map(list => `❖ ${ctx.format.bold(list.name)} (${list.abbr})\n┊    ♡ Bab › ${list.chapter}`);
                break;
            }
            case "alquran": {
                title = "𝑫𝒂𝒇𝒕𝒂𝒓 𝑺𝒖𝒓𝒂𝒉";
                const data = (await ctx.request.get("https://raw.githubusercontent.com/penggguna/QuranJSON/master/quran.json")).data;
                items = data.map(list => `❖ ${ctx.format.bold(list.name)} (${list.number_of_surah})\n┊    ♡ Ayat › ${list.number_of_ayah}`);
                break;
            }
            case "claim": {
                title = "𝑫𝒂𝒇𝒕𝒂𝒓 𝑲𝒍𝒂𝒊𝒎";
                const data = [
                    { cmd: "daily", desc: "Hadiah harian (Reset 24 jam)" },
                    { cmd: "weekly", desc: "Hadiah mingguan (Reset 7 hari)" },
                    { cmd: "monthly", desc: "Hadiah bulanan (Reset 30 hari)" },
                    { cmd: "yearly", desc: "Hadiah tahunan (Reset 365 hari)" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            case "group": {
                title = "𝑶𝒑𝒔𝒊 𝑮𝒓𝒐𝒖𝒑";
                const data = [
                    { cmd: "open", desc: "Buka grup" },
                    { cmd: "close", desc: "Tutup grup" },
                    { cmd: "lock", desc: "Kunci grup" },
                    { cmd: "unlock", desc: "Buka kunci grup" },
                    { cmd: "approve", desc: "Aktifkan persetujuan masuk" },
                    { cmd: "disapprove", desc: "Nonaktifkan persetujuan masuk" },
                    { cmd: "invite", desc: "Izinkan anggota menambah anggota" },
                    { cmd: "restrict", desc: "Hanya admin yang bisa menambah anggota" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            case "mode": {
                title = "𝑴𝒐𝒅𝒆 𝑩𝒐𝒕";
                const data = [
                    { cmd: "premium", desc: "Hanya merespons pengguna premium dan owner" },
                    { cmd: "group", desc: "Hanya merespons dalam grup" },
                    { cmd: "private", desc: "Hanya merespons dalam obrolan pribadi" },
                    { cmd: "public", desc: "Merespons dalam grup dan obrolan pribadi" },
                    { cmd: "self", desc: "Hanya merespons dirinya sendiri dan owner" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            case "osettext": {
                title = "𝑶𝒘𝒏𝒆𝒓 𝑺𝒆𝒕 𝑻𝒆𝒌𝒔";
                const data = [
                    { cmd: "donate", desc: "Atur teks donasi (%tag%, %name%, %prefix%, etc.)" },
                    { cmd: "price", desc: "Atur teks harga (%tag%, %name%, %prefix%, etc.)" },
                    { cmd: "qris", desc: "Atur gambar QRIS (berupa link gambar)" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            case "setoption": {
                title = "𝑶𝒑𝒔𝒊 𝑮𝒓𝒖𝒑";
                const data = [
                    { cmd: "antiaudio", desc: "Anti audio di grup" },
                    { cmd: "antidocument", desc: "Anti dokumen di grup" },
                    { cmd: "antiimage", desc: "Anti gambar di grup" },
                    { cmd: "antisticker", desc: "Anti stiker di grup" },
                    { cmd: "antivideo", desc: "Anti video di grup" },
                    { cmd: "antigcsw", desc: "Anti status grup di grup" },
                    { cmd: "antilink", desc: "Anti kirim tautan/link" },
                    { cmd: "antispam", desc: "Anti spam chat berlebihan" },
                    { cmd: "antitagsw", desc: "Anti tag story WhatsApp" },
                    { cmd: "antitoxic", desc: "Anti kata-kata kasar / toxic" },
                    { cmd: "autokick", desc: "Keluarkan pelanggar otomatis" },
                    { cmd: "gamerestrict", desc: "Batasi penggunaan game" },
                    { cmd: "welcome", desc: "Pesan sambutan member baru" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            case "settext": {
                title = "𝑻𝒆𝒌𝒔 𝑮𝒓𝒖𝒑";
                const data = [
                    { cmd: "goodbye", desc: "Teks selamat tinggal (%tag%, %subject%, %description%)" },
                    { cmd: "intro", desc: "Teks perkenalan member" },
                    { cmd: "welcome", desc: "Teks selamat datang (%tag%, %subject%, %description%)" }
                ];
                items = data.map(d => `❖ ${ctx.format.bold(d.cmd)}\n┊    ♡ Info › ${d.desc}`);
                break;
            }
            default:
                return ctx.format.info(`Tipe tidak diketahui: ${type}`);
        }

        let text = "╭───────────────୨୧\n" +
                   `│  ₊˚⊹♡  ${title}  ♡⊹˚₊\n` +
                   "│  (｡･ω･｡)ﾉ♡ Berikut daftar pilihannya:\n" +
                   "╰───────────────୨୧\n\n" +
                   "╭┈┈┈┈┈┈┈┈୨୧\n" +
                   `┊ ✦ 𝑷𝒊𝒍𝒊𝒉𝒂𝒏 ୨୧\n` +
                   items.map(i => `┊ ${i}`).join("\n┊\n") + "\n" +
                   "╰┈┈┈┈┈┈┈┈୨୧\n\n" +
                   "╭───────────────୨୧\n" +
                   "│ (｡•̀ᴗ-)✧ Pilih sesuai kebutuhan kamu ya! ♡\n" +
                   "╰───────────────୨୧";

        return text;
    } catch (error) {
        return null;
    }
}

module.exports = {
    get
};