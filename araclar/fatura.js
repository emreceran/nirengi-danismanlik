/* Fatura fiyat kontrolü — e-fatura (UBL-TR) XML/ZIP ya da Excel/CSV alış listesi.
   Her şey tarayıcıda çalışır; dosyalar hiçbir sunucuya gönderilmez. */
(function () {
  "use strict";

  var BIRIMLER = { C62: "adet", NIU: "adet", H87: "adet", KGM: "kg", GRM: "g", TNE: "ton", MTR: "m", CMT: "cm",
    MTK: "m²", MTQ: "m³", LTR: "lt", MLT: "ml", BX: "kutu", PA: "paket", SET: "set", PR: "çift", KWH: "kWh",
    HUR: "saat", DAY: "gün", MON: "ay", ANN: "yıl", BG: "torba", CT: "koli", ROL: "rulo" };

  var durum = { kalemler: [], faturalar: {}, notlar: [] };
  var $ = function (s) { return document.querySelector(s); };
  var sayi = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var tam = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
  var yuzde = new Intl.NumberFormat("tr-TR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function trUst(s) { return String(s || "").replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase(); }
  function normal(ad) {
    return trUst(ad).replace(/[.,;:*×xX\/\\()\-_"']/g, " ").replace(/(\d)\s+(?=\d)/g, "$1 ").replace(/\s+/g, " ").trim();
  }
  function tarihYaz(d) { return d ? d.toLocaleDateString("tr-TR") : ""; }
  function gun(d) { return Math.floor(d.getTime() / 86400000); }

  // ------------------------------------------------------------ UBL okuma
  function cocuk(el, ad) {
    if (!el) return null;
    for (var i = 0; i < el.children.length; i++) if (el.children[i].localName === ad) return el.children[i];
    return null;
  }
  function cocuklar(el, ad) {
    var o = [];
    if (!el) return o;
    for (var i = 0; i < el.children.length; i++) if (el.children[i].localName === ad) o.push(el.children[i]);
    return o;
  }
  function yol(el) {
    for (var i = 1; i < arguments.length && el; i++) el = cocuk(el, arguments[i]);
    return el;
  }
  function metin(el) { return el ? el.textContent.trim() : ""; }
  function num(s) { var n = parseFloat(String(s).replace(",", ".")); return isFinite(n) ? n : 0; }

  function ublOku(xmlMetni, dosyaAdi) {
    var doc = new DOMParser().parseFromString(xmlMetni, "application/xml");
    var kok = doc.documentElement;
    if (!kok || kok.localName !== "Invoice") {
      var ic = doc.getElementsByTagNameNS("*", "Invoice")[0];
      if (!ic) return null;
      kok = ic;
    }
    var taraf = yol(kok, "AccountingSupplierParty", "Party");
    var ad = metin(yol(taraf, "PartyName", "Name"));
    if (!ad) {
      var kisi = cocuk(taraf, "Person");
      ad = [metin(cocuk(kisi, "FirstName")), metin(cocuk(kisi, "FamilyName"))].join(" ").trim();
    }
    var vkn = "";
    cocuklar(taraf, "PartyIdentification").forEach(function (p) {
      var id = cocuk(p, "ID");
      if (id && /VKN|TCKN/i.test(id.getAttribute("schemeID") || "")) vkn = metin(id);
    });
    var f = {
      no: metin(cocuk(kok, "ID")),
      uuid: metin(cocuk(kok, "UUID")),
      tarih: new Date(metin(cocuk(kok, "IssueDate")) + "T00:00:00"),
      tip: metin(cocuk(kok, "InvoiceTypeCode")),
      para: metin(cocuk(kok, "DocumentCurrencyCode")) || "TRY",
      tedarikci: ad || vkn || "Bilinmeyen tedarikçi",
      vkn: vkn,
      toplam: num(metin(yol(kok, "LegalMonetaryTotal", "PayableAmount"))),
      dosya: dosyaAdi,
      kalemler: []
    };
    if (isNaN(f.tarih)) return null;
    cocuklar(kok, "InvoiceLine").forEach(function (s) {
      var miktarEl = cocuk(s, "InvoicedQuantity");
      var miktar = num(metin(miktarEl));
      var birimKod = miktarEl ? miktarEl.getAttribute("unitCode") || "" : "";
      var tutar = num(metin(cocuk(s, "LineExtensionAmount")));
      var liste = num(metin(yol(s, "Price", "PriceAmount")));
      var urun = metin(yol(s, "Item", "Name")) || metin(yol(s, "Item", "Description"));
      if (!urun || miktar <= 0) return;
      f.kalemler.push({ urun: urun, miktar: miktar, birim: BIRIMLER[birimKod] || birimKod.toLowerCase() || "?",
        fiyat: tutar > 0 ? tutar / miktar : liste, liste: liste, tutar: tutar || liste * miktar });
    });
    return f;
  }

  // ------------------------------------------------------------ Excel / CSV okuma
  var KOLON = {
    tarih: /tarih/i, tedarikci: /tedarik|sat[ıi]c[ıi]|cari|firma|unvan/i, no: /fatura\s*no|belge\s*no|evrak\s*no|^no$/i,
    urun: /[üu]r[üu]n|stok\s*ad|malzeme|hizmet|a[çc][ıi]klama|kalem/i, miktar: /miktar|adet/i, birim: /^birim$|[öo]l[çc][üu]/i,
    fiyat: /birim\s*fiyat|^fiyat/i, tutar: /tutar|toplam/i
  };
  function excelTarih(v) {
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000));
    var m = String(v || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (m) return new Date(+(m[3].length === 2 ? "20" + m[3] : m[3]), +m[2] - 1, +m[1]);
    var d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function trSayi(v) {
    if (typeof v === "number") return v;
    var s = String(v || "").replace(/\s|₺|TL/g, "");
    if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function tabloOku(satirlar, dosyaAdi) {
    var bas = -1, kol = {};
    for (var i = 0; i < Math.min(satirlar.length, 20) && bas < 0; i++) {
      var k = {};
      (satirlar[i] || []).forEach(function (h, j) {
        var t = String(h || "").trim();
        Object.keys(KOLON).forEach(function (a) {
          if (k[a] == null && KOLON[a].test(t)) {
            if (a === "tutar" && /birim/i.test(t)) return;
            if (a === "urun" && k.urun != null) return;
            k[a] = j;
          }
        });
      });
      if (k.urun != null && k.miktar != null && (k.fiyat != null || k.tutar != null)) { bas = i; kol = k; }
    }
    if (bas < 0) {
      durum.notlar.push(dosyaAdi + ": ürün, miktar ve fiyat sütunları bulunamadı. Başlık satırında bu adlar geçmeli.");
      return 0;
    }
    var n = 0;
    for (var r = bas + 1; r < satirlar.length; r++) {
      var s = satirlar[r] || [];
      var urun = String(s[kol.urun] || "").trim();
      var miktar = trSayi(s[kol.miktar]);
      if (!urun || miktar <= 0) continue;
      var fiyat = kol.fiyat != null ? trSayi(s[kol.fiyat]) : 0;
      var tutar = kol.tutar != null ? trSayi(s[kol.tutar]) : 0;
      if (!fiyat && tutar) fiyat = tutar / miktar;
      if (!fiyat) continue;
      var t = kol.tarih != null ? excelTarih(s[kol.tarih]) : null;
      if (!t) continue;
      var no = kol.no != null ? String(s[kol.no] || "") : "";
      var ted = kol.tedarikci != null ? String(s[kol.tedarikci] || "").trim() : "Belirtilmemiş";
      kalemEkle({ no: no, uuid: "", tarih: t, tedarikci: ted || "Belirtilmemiş", para: "TRY", dosya: dosyaAdi, tablo: true },
        { urun: urun, miktar: miktar, birim: kol.birim != null ? String(s[kol.birim] || "").trim().toLowerCase() || "?" : "?",
          fiyat: fiyat, tutar: tutar || fiyat * miktar });
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------ Toplama
  function faturaEkle(f) {
    var anahtar = f.uuid || (f.tedarikci + "|" + f.no);
    if (durum.faturalar[anahtar]) { durum.tekrarDosya = (durum.tekrarDosya || 0) + 1; return; }
    durum.faturalar[anahtar] = f;
    if (/IADE/i.test(f.tip)) { durum.iade = (durum.iade || 0) + 1; return; }
    f.kalemler.forEach(function (k) { kalemEkle(f, k); });
  }
  function kalemEkle(f, k) {
    durum.kalemler.push({
      tarih: f.tarih, tedarikci: f.tedarikci, no: f.no, para: f.para, dosya: f.dosya, tablo: !!f.tablo,
      urun: k.urun, miktar: k.miktar, birim: k.birim, fiyat: k.fiyat, tutar: k.tutar,
      anahtar: normal(k.urun) + "|" + k.birim + "|" + f.para
    });
  }

  function dosyalariOku(liste) {
    var islemler = [];
    Array.prototype.forEach.call(liste, function (d) {
      var ad = d.name.toLowerCase();
      if (ad.endsWith(".xml")) islemler.push(d.text().then(function (t) { xmlIsle(t, d.name); }));
      else if (ad.endsWith(".zip")) islemler.push(zipIsle(d, d.name));
      else if (/\.(xlsx|xls|csv|ods)$/.test(ad)) islemler.push(tabloIsle(d));
      else durum.notlar.push(d.name + ": desteklenmeyen dosya türü, atlandı.");
    });
    return Promise.all(islemler);
  }
  function xmlIsle(t, ad) {
    var f = ublOku(t, ad);
    if (f) faturaEkle(f);
    else if (!/\.xslt?$/i.test(ad)) durum.notlar.push(ad + ": e-fatura (UBL) biçiminde değil, atlandı.");
  }
  function zipIsle(blob, ad) {
    if (!window.JSZip) { durum.notlar.push("ZIP kütüphanesi yüklenemedi; XML dosyalarını ayrı ayrı yükleyin."); return Promise.resolve(); }
    return JSZip.loadAsync(blob).then(function (z) {
      var is = [];
      z.forEach(function (yolu, g) {
        if (g.dir) return;
        if (/\.xml$/i.test(yolu)) is.push(g.async("string").then(function (t) { xmlIsle(t, ad + " › " + yolu); }));
        else if (/\.zip$/i.test(yolu)) is.push(g.async("blob").then(function (b) { return zipIsle(b, ad + " › " + yolu); }));
      });
      return Promise.all(is);
    }).catch(function () { durum.notlar.push(ad + ": ZIP dosyası açılamadı."); });
  }
  function tabloIsle(d) {
    if (!window.XLSX) { durum.notlar.push("Excel kütüphanesi yüklenemedi; sayfayı yenileyip tekrar deneyin."); return Promise.resolve(); }
    return d.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: "array", cellDates: true });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var n = tabloOku(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }), d.name);
      if (n) durum.notlar.push(d.name + ": " + n + " kalem okundu.");
    });
  }

  // ------------------------------------------------------------ Analiz
  function mukerrerBul() {
    var muk = [];
    durum.kalemler.forEach(function (k) { k.tekrar = false; });
    // Aynı tedarikçi, aynı ödenecek tutar, farklı fatura no, 5 gün içinde
    var fl = Object.keys(durum.faturalar).map(function (k) { return durum.faturalar[k]; }).filter(function (f) { return f.toplam > 0; });
    fl.sort(function (a, b) { return a.tarih - b.tarih; });
    for (var i = 0; i < fl.length; i++) for (var j = i + 1; j < fl.length; j++) {
      var a = fl[i], b = fl[j];
      if (gun(b.tarih) - gun(a.tarih) > 5) break;
      if (a.tedarikci === b.tedarikci && Math.abs(a.toplam - b.toplam) < 0.01 && a.no !== b.no) {
        muk.push([a, b]);
        durum.kalemler.forEach(function (k) { if (!k.tablo && k.tedarikci === b.tedarikci && k.no === b.no) k.tekrar = true; });
      }
    }
    // Excel girişinde birebir aynı kalem tekrarları
    var gorulen = {};
    durum.kalemler.forEach(function (k) {
      if (!k.tablo) return;
      var a = [k.tedarikci, k.no, k.urun, k.miktar, k.fiyat.toFixed(4)].join("|");
      if (gorulen[a]) {
        k.tekrar = true;
        muk.push([{ tedarikci: k.tedarikci, no: k.no, tarih: gorulen[a].tarih, toplam: k.tutar },
          { tedarikci: k.tedarikci, no: k.no + " · " + k.urun + " (aynı kalem ikinci kez)", tarih: k.tarih, toplam: k.tutar }]);
      } else gorulen[a] = k;
    });
    return muk;
  }

  function analiz() {
    var esik = (parseFloat($("#esik").value) || 10) / 100;
    var pencere = parseInt($("#pencere").value, 10) || 90;
    // Önce mükerrer şüphesi: ikinci kopyalar fiyat karşılaştırmasına ve fazla ödeme toplamına katılmaz
    var muk = mukerrerBul();
    var gruplar = {};
    durum.kalemler.forEach(function (k) { if (!k.tekrar) (gruplar[k.anahtar] = gruplar[k.anahtar] || []).push(k); });
    var incele = [], urunler = [], fazla = 0;
    Object.keys(gruplar).forEach(function (a) {
      var g = gruplar[a].sort(function (x, y) { return x.tarih - y.tarih; });
      var tedSet = {};
      g.forEach(function (k) {
        tedSet[k.tedarikci] = 1;
        var gk = gun(k.tarih);
        var onceki = g.filter(function (o) { var go = gun(o.tarih); return go < gk && go >= gk - pencere; });
        var donem = g.filter(function (o) { var go = gun(o.tarih); return go <= gk && go >= gk - pencere; });
        k.ref = onceki.length ? onceki.reduce(function (t, o) { return t + o.fiyat; }, 0) / onceki.length : null;
        k.enDusuk = Math.min.apply(null, donem.map(function (o) { return o.fiyat; }));
        k.enDusukTed = (donem.filter(function (o) { return o.fiyat === k.enDusuk; })[0] || {}).tedarikci;
        k.fark = k.ref ? k.fiyat / k.ref - 1 : null;
        k.fazla = k.fark != null && k.fark >= esik ? (k.fiyat - k.ref) * k.miktar : 0;
        if (k.fazla > 0) { incele.push(k); fazla += k.fazla; }
      });
      var fiyatlar = g.map(function (k) { return k.fiyat; });
      urunler.push({ ad: g[0].urun, birim: g[0].birim, para: g[0].para, kalemler: g, alim: g.length,
        tedarikci: Object.keys(tedSet).length, min: Math.min.apply(null, fiyatlar), max: Math.max.apply(null, fiyatlar),
        son: g[g.length - 1].fiyat, tutar: g.reduce(function (t, k) { return t + k.tutar; }, 0),
        incele: g.filter(function (k) { return k.fazla > 0; }).length });
    });
    incele.sort(function (x, y) { return y.fazla - x.fazla; });
    urunler.sort(function (x, y) { return y.incele - x.incele || y.tutar - x.tutar; });
    return { incele: incele, urunler: urunler, fazla: fazla, muk: muk, esik: esik, pencere: pencere };
  }

  // ------------------------------------------------------------ Gösterim
  function cizgi(u) {
    var g = u.kalemler, w = 260, h = 60, p = 6;
    if (g.length < 2) return "";
    var t0 = gun(g[0].tarih), t1 = gun(g[g.length - 1].tarih) || t0 + 1;
    var min = u.min, max = u.max === u.min ? u.min + 1 : u.max;
    var x = function (k) { return p + (w - 2 * p) * (t1 === t0 ? 0.5 : (gun(k.tarih) - t0) / (t1 - t0)); };
    var y = function (k) { return h - p - (h - 2 * p) * (k.fiyat - min) / (max - min); };
    var d = g.map(function (k, i) { return (i ? "L" : "M") + x(k).toFixed(1) + " " + y(k).toFixed(1); }).join(" ");
    var noktalar = g.map(function (k) {
      return '<circle cx="' + x(k).toFixed(1) + '" cy="' + y(k).toFixed(1) + '" r="' + (k.fazla > 0 ? 3.5 : 2.2) +
        '" class="' + (k.fazla > 0 ? "nokta-uyari" : "nokta") + '"><title>' + esc(tarihYaz(k.tarih) + " · " + k.tedarikci + " · " + sayi.format(k.fiyat)) + "</title></circle>";
    }).join("");
    return '<svg class="cizgi" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Fiyat geçmişi"><path d="' + d + '"/>' + noktalar + "</svg>";
  }

  function goster() {
    var s = analiz();
    var fc = Object.keys(durum.faturalar).length;
    $("#sonuc").hidden = false;
    $("#ozet").innerHTML = [
      ["Fatura", tam.format(fc || new Set(durum.kalemler.map(function (k) { return k.tedarikci + k.no; })).size)],
      ["Kalem", tam.format(durum.kalemler.length)],
      ["Ürün", tam.format(s.urunler.length)],
      ["İncelenecek alım", tam.format(s.incele.length)],
      ["Olası fazla ödeme", sayi.format(s.fazla) + " ₺"],
      ["Mükerrer şüphesi", tam.format(s.muk.length)]
    ].map(function (o, i) { return '<div class="' + ((i === 3 && s.incele.length) || (i === 5 && s.muk.length) ? "vurgulu" : "") + '"><span>' + o[0] + "</span><strong>" + o[1] + "</strong></div>"; }).join("");

    var notlar = durum.notlar.slice();
    var tekrarli = s.urunler.filter(function (u) { return u.alim > 1; }).length;
    var uyari = "";
    if (!tekrarli) uyari = "Yüklenen faturalarda aynı ürünün birden fazla alımı yok, bu yüzden fiyat karşılaştırması yapılamadı. " +
      "Araç bir dönemin faturalarıyla çalışır: örneğin son 6 ya da 12 ayın tüm alış faturalarını birlikte yükleyin.";
    else if (fc && fc < 10) uyari = "Yalnızca " + fc + " fatura yüklendi. Karşılaştırmanın anlamlı olması için bir dönemin (örneğin son 6–12 ay) tüm alış faturalarını yüklemenizi öneririz.";
    $("#donem-uyari").hidden = !uyari;
    $("#donem-uyari").textContent = uyari;
    if (durum.tekrarDosya) notlar.push(durum.tekrarDosya + " dosya daha önce yüklenen bir faturanın kopyasıydı; bir kez sayıldı.");
    if (durum.iade) notlar.push(durum.iade + " iade faturası fiyat karşılaştırmasına katılmadı.");
    $("#notlar").innerHTML = notlar.length ? "<ul>" + notlar.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "";

    $("#incele-baslik").textContent = "İncelenecek alımlar (" + s.incele.length + ")";
    $("#incele").innerHTML = s.incele.length ? tablo(["Tarih", "Tedarikçi", "Fatura no", "Ürün", "Miktar", "Birim fiyat", "Önceki ort.", "Fark", "Dönemin en düşüğü", "Olası fazla ödeme"],
      s.incele.map(function (k) {
        return [tarihYaz(k.tarih), esc(k.tedarikci), esc(k.no), esc(k.urun), sayi.format(k.miktar) + " " + esc(k.birim), sayi.format(k.fiyat),
          sayi.format(k.ref), '<b class="kirmizi">+' + yuzde.format(k.fark) + "</b>", sayi.format(k.enDusuk) + '<small>' + esc(k.enDusukTed || "") + "</small>", "<b>" + sayi.format(k.fazla) + "</b>"];
      }), [4, 5, 6, 7, 8, 9]) : '<p class="bos">Seçtiğiniz eşiğin üzerinde fiyat sapması bulunmadı.</p>';

    $("#muk-baslik").textContent = "Mükerrer şüphesi (" + s.muk.length + ")";
    $("#muk").innerHTML = s.muk.length ? tablo(["Tedarikçi", "1. fatura", "2. fatura", "Tutar"], s.muk.map(function (m) {
      return [esc(m[0].tedarikci), esc(m[0].no) + "<small>" + tarihYaz(m[0].tarih) + "</small>", esc(m[1].no) + "<small>" + tarihYaz(m[1].tarih) + "</small>", sayi.format(m[0].toplam)];
    }), [3]) : '<p class="bos">Aynı tedarikçiden, aynı tutarda ve birbirine yakın tarihli fatura bulunmadı.</p>';

    $("#urun").innerHTML = tablo(["Ürün", "Alım", "Tedarikçi", "En düşük", "En yüksek", "Son fiyat", "Aralık", "Fiyat geçmişi"],
      s.urunler.map(function (u) {
        return [esc(u.ad) + "<small>" + esc(u.birim) + (u.para !== "TRY" ? " · " + esc(u.para) : "") + "</small>", u.alim, u.tedarikci,
          sayi.format(u.min), sayi.format(u.max), sayi.format(u.son),
          (u.max > u.min ? (u.max / u.min - 1 >= s.esik ? '<b class="kirmizi">' : "<b>") + yuzde.format(u.max / u.min - 1) + "</b>" : "—"), cizgi(u)];
      }), [1, 2, 3, 4, 5, 6]);
    durum.son = s;
    $("#sonuc").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function tablo(basliklar, satirlar, sagaDayali) {
    var sag = function (i) { return sagaDayali.indexOf(i) >= 0 ? ' class="sag"' : ""; };
    return '<div class="tablo-kap"><table><thead><tr>' + basliklar.map(function (b, i) { return "<th" + sag(i) + ">" + b + "</th>"; }).join("") +
      "</tr></thead><tbody>" + satirlar.map(function (s) { return "<tr>" + s.map(function (h, i) { return "<td" + sag(i) + ">" + h + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
  }

  function csvIndir() {
    var s = durum.son;
    if (!s) return;
    var sat = [["Tarih", "Tedarikçi", "Fatura no", "Ürün", "Miktar", "Birim", "Birim fiyat", "Önceki ortalama", "Fark %", "Dönemin en düşüğü", "Olası fazla ödeme"]];
    s.incele.forEach(function (k) {
      sat.push([tarihYaz(k.tarih), k.tedarikci, k.no, k.urun, k.miktar, k.birim, k.fiyat.toFixed(2), k.ref.toFixed(2), (k.fark * 100).toFixed(1), k.enDusuk.toFixed(2), k.fazla.toFixed(2)]);
    });
    var csv = "﻿" + sat.map(function (r) { return r.map(function (h) { return '"' + String(h).replace(/"/g, '""') + '"'; }).join(";"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "fiyat-sapma-listesi.csv";
    a.click();
  }

  // ------------------------------------------------------------ Örnek veri (UBL XML olarak üretilir, aynı okuyucudan geçer)
  function ornekXml(no, tarih, ted, vkn, satirlar) {
    var top = 0;
    var s = satirlar.map(function (x, i) {
      var tutar = Math.round(x[1] * x[3] * 100) / 100;
      top += tutar;
      return '<cac:InvoiceLine><cbc:ID>' + (i + 1) + '</cbc:ID><cbc:InvoicedQuantity unitCode="' + x[2] + '">' + x[1] + '</cbc:InvoicedQuantity>' +
        '<cbc:LineExtensionAmount currencyID="TRY">' + tutar.toFixed(2) + '</cbc:LineExtensionAmount><cac:Item><cbc:Name>' + x[0] +
        '</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">' + x[3].toFixed(2) + "</cbc:PriceAmount></cac:Price></cac:InvoiceLine>";
    }).join("");
    var odenecek = (top * 1.2).toFixed(2);
    return '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
      'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
      "<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TICARIFATURA</cbc:ProfileID>" +
      "<cbc:ID>" + no + "</cbc:ID><cbc:UUID>" + no + "-ornek</cbc:UUID><cbc:IssueDate>" + tarih + "</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>" +
      "<cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID=\"VKN\">" + vkn +
      "</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>" + ted + "</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>" + s +
      '<cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="TRY">' + odenecek + "</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>";
  }
  function ornekYukle() {
    sifirla();
    var K = "Konya Demir Ltd.", A = "Anadolu Çelik A.Ş.", M = "Kaynak Market", O = "Ova Ambalaj";
    var fat = [
      ["KD2026000412", "2026-05-06", K, "1111111111", [["KUTU PROF.40X40X2", 1200, "KGM", 37.2], ["SAC 1,5MM DKP", 800, "KGM", 33.9]]],
      ["AC2026001187", "2026-05-20", A, "2222222222", [["Kutu Prof. 40x40x2", 900, "KGM", 37.9]]],
      ["KM2026002210", "2026-05-12", M, "3333333333", [["SG2 Kaynak Teli 1.2mm", 300, "KGM", 96], ["Gazaltı torç memesi", 40, "C62", 85]]],
      ["OA2026000045", "2026-05-15", O, "4444444444", [["Kraft koli 60x40x40", 500, "C62", 27.5]]],
      ["KD2026000533", "2026-06-10", K, "1111111111", [["KUTU PROF.40X40X2", 1500, "KGM", 38.4], ["SAC 1,5MM DKP", 600, "KGM", 34.6]]],
      ["KM2026002391", "2026-06-18", M, "3333333333", [["SG2 Kaynak Teli 1.2mm", 300, "KGM", 97], ["Gazaltı torç memesi", 40, "C62", 86]]],
      ["KD2026000611", "2026-07-02", K, "1111111111", [["KUTU PROF.40X40X2", 1100, "KGM", 39.1]]],
      ["OA2026000071", "2026-07-08", O, "4444444444", [["Kraft koli 60x40x40", 600, "C62", 27.55]]],
      ["AC2026001342", "2026-07-21", A, "2222222222", [["Kutu Prof. 40x40x2", 1000, "KGM", 39.4], ["SAC 1,5MM DKP", 700, "KGM", 35.1]]],
      ["KM2026002580", "2026-08-04", M, "3333333333", [["SG2 Kaynak Teli 1.2mm", 360, "KGM", 112.5], ["Gazaltı torç memesi", 40, "C62", 86]]],
      ["KM2026002587", "2026-08-06", M, "3333333333", [["SG2 Kaynak Teli 1.2mm", 360, "KGM", 112.5], ["Gazaltı torç memesi", 40, "C62", 86]]],
      ["KD2026000702", "2026-08-19", K, "1111111111", [["KUTU PROF.40X40X2", 1300, "KGM", 45.9], ["SAC 1,5MM DKP", 900, "KGM", 35.4]]],
      ["OA2026000093", "2026-08-22", O, "4444444444", [["Kraft koli 60x40x40", 500, "C62", 27.9]]],
      ["AC2026001498", "2026-09-03", A, "2222222222", [["Kutu Prof. 40x40x2", 1200, "KGM", 40.1]]],
      ["KD2026000788", "2026-09-16", K, "1111111111", [["KUTU PROF.40X40X2", 1000, "KGM", 46.4], ["SAC 1,5MM DKP", 650, "KGM", 41.2]]]
    ];
    fat.forEach(function (f) { xmlIsle(ornekXml(f[0], f[1], f[2], f[3], f[4]), f[0] + ".xml"); });
    durum.notlar.push("Örnek veri: dört tedarikçiden, beş aylık dönemde 15 kurgusal e-fatura.");
    durum.ornek = true;
    $("#dosya-durum").textContent = "Örnek veri yüklendi.";
    goster();
  }

  function sifirla() {
    durum = { kalemler: [], faturalar: {}, notlar: [] };
    $("#temizle").hidden = true;
    $("#sonuc").hidden = true;
    $("#dosya-durum").textContent = "";
  }

  // Yeni dosyalar öncekilere eklenir (faturalar farklı klasörlerde olabilir); aynı fatura iki kez sayılmaz.
  function basla(liste) {
    if (!liste || !liste.length) return;
    if (durum.ornek) sifirla();
    durum.notlar = [];
    $("#dosya-durum").textContent = liste.length + " dosya okunuyor…";
    dosyalariOku(liste).then(function () {
      durum.dosyaSayisi = (durum.dosyaSayisi || 0) + liste.length;
      if (!durum.kalemler.length) {
        $("#dosya-durum").textContent = "Okunabilir fatura kalemi bulunamadı.";
        $("#sonuc").hidden = true;
        if (durum.notlar.length) alert(durum.notlar.join("\n"));
        return;
      }
      $("#dosya-durum").textContent = "Toplam " + durum.dosyaSayisi + " dosya okundu. Başka dosya da ekleyebilirsiniz.";
      $("#temizle").hidden = false;
      goster();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var alan = $("#yukle"), girdi = $("#dosyalar");
    girdi.addEventListener("change", function () { basla(girdi.files); });
    ["dragenter", "dragover"].forEach(function (o) { alan.addEventListener(o, function (e) { e.preventDefault(); alan.classList.add("ustunde"); }); });
    ["dragleave", "drop"].forEach(function (o) { alan.addEventListener(o, function (e) { e.preventDefault(); alan.classList.remove("ustunde"); }); });
    alan.addEventListener("drop", function (e) { basla(e.dataTransfer.files); });
    $("#ornek").addEventListener("click", ornekYukle);
    $("#temizle").addEventListener("click", function (e) { e.preventDefault(); sifirla(); girdi.value = ""; });
    $("#esik").addEventListener("change", function () { if (durum.kalemler.length) goster(); });
    $("#pencere").addEventListener("change", function () { if (durum.kalemler.length) goster(); });
    $("#csv").addEventListener("click", csvIndir);
    if (/[?&]ornek=1/.test(location.search)) ornekYukle();
  });
})();
