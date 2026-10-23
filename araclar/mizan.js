/* Mizan röntgeni — Tekdüzen Hesap Planı'na göre mizandan ön değerlendirme.
   Her şey tarayıcıda çalışır; dosya hiçbir sunucuya gönderilmez. */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var tl = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
  var ondalik = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var yuzde = new Intl.NumberFormat("tr-TR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var son = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function trSayi(v) {
    if (typeof v === "number") return v;
    var s = String(v || "").replace(/\s|₺|TL/g, "");
    var eksi = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, "");
    if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s);
    return isFinite(n) ? (eksi ? -n : n) : 0;
  }
  function M(n) { return tl.format(Math.round(n)) + " ₺"; }

  // ------------------------------------------------------------ Okuma
  function sutunBul(satirlar) {
    for (var i = 0; i < Math.min(satirlar.length, 25); i++) {
      var k = {};
      (satirlar[i] || []).forEach(function (h, j) {
        var t = String(h || "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
        if (!t) return;
        if (k.kod == null && /(hesap )?kod|hesap no|^hesap$/.test(t)) k.kod = j;
        else if (k.ad == null && /(hesap )?ad[ıi]|a[çc][ıi]klama|unvan/.test(t)) k.ad = j;
        else if (/bor[çc]/.test(t) && /bakiye/.test(t)) k.bb = j;
        else if (/alacak/.test(t) && /bakiye/.test(t)) k.ab = j;
        else if (/^bakiye$/.test(t)) k.bk = j;
        else if (/bor[çc]/.test(t) && k.b == null) k.b = j;
        else if (/alacak/.test(t) && k.a == null) k.a = j;
      });
      if (k.kod != null && ((k.bb != null && k.ab != null) || k.bk != null || (k.b != null && k.a != null))) return { bas: i, k: k };
    }
    return null;
  }

  function mizanOku(satirlar) {
    var b = sutunBul(satirlar);
    var hesap = {}, adlar = {}, anaVar = {};
    var kaynak = [];
    if (!b) {
      // Başlık bulunamazsa: ilk sütun kod, son iki sayısal sütun borç/alacak bakiye varsayılır
      satirlar.forEach(function (s) {
        var kod = String(s[0] || "").trim();
        if (!/^\d{3}/.test(kod)) return;
        var sayilar = s.slice(1).filter(function (v) { return v !== "" && isFinite(trSayi(v)) && /\d/.test(String(v)); });
        if (sayilar.length < 2) return;
        kaynak.push([kod, String(s[1] || ""), trSayi(sayilar[sayilar.length - 2]) - trSayi(sayilar[sayilar.length - 1])]);
      });
    } else {
      var k = b.k;
      for (var r = b.bas + 1; r < satirlar.length; r++) {
        var s = satirlar[r] || [];
        var kod = String(s[k.kod] || "").trim();
        if (!/^\d{3}/.test(kod)) continue;
        var bakiye;
        if (k.bb != null && k.ab != null) bakiye = trSayi(s[k.bb]) - trSayi(s[k.ab]);
        else if (k.bk != null) bakiye = trSayi(s[k.bk]);
        else bakiye = trSayi(s[k.b]) - trSayi(s[k.a]);
        kaynak.push([kod, k.ad != null ? String(s[k.ad] || "") : "", bakiye]);
      }
    }
    kaynak.forEach(function (x) { if (/^\d{3}$/.test(x[0].replace(/\s/g, ""))) anaVar[x[0].trim()] = 1; });
    kaynak.forEach(function (x) {
      var temiz = x[0].replace(/\s/g, "");
      var ana = temiz.slice(0, 3);
      var anaSatir = /^\d{3}$/.test(temiz);
      if (!anaSatir && anaVar[ana]) return;  // ana hesap satırı varsa alt kırılımlar çift sayılmasın
      hesap[ana] = (hesap[ana] || 0) + x[2];
      if (anaSatir || !adlar[ana]) adlar[ana] = x[1];
    });
    return { hesap: hesap, adlar: adlar, satir: kaynak.length };
  }

  // ------------------------------------------------------------ Analiz
  function analiz(m, ay) {
    var h = m.hesap;
    var b = function (kod) { return h[kod] || 0; };
    var grup = function (on) {
      return Object.keys(h).reduce(function (t, k) { return k.indexOf(on) === 0 ? t + h[k] : t; }, 0);
    };
    var gunSay = ay * 30;
    var v = {};
    v.donen = grup("1"); v.duran = grup("2"); v.aktif = v.donen + v.duran;
    v.kvyk = -grup("3"); v.uvyk = -grup("4");
    v.sonuc = -(grup("6") + grup("7"));
    v.ozkaynak = -grup("5") + v.sonuc;
    v.hazir = grup("10"); v.kasa = b("100"); v.banka = b("102");
    v.ticAlacak = grup("12"); v.stok = grup("15");
    v.ortakAlacak = b("131") + b("231");
    v.kdv = b("190");
    v.ticBorc = -grup("32"); v.kvFin = -grup("30"); v.uvFin = -grup("40");
    v.netSatis = -(grup("60") + grup("61"));
    v.smm = grup("62");
    v.brut = v.netSatis - v.smm;
    v.faalGider = grup("63");
    v.faalKar = v.brut - v.faalGider;
    v.digerGelir = -grup("64"); v.digerGider = grup("65"); v.finGider = grup("66");
    v.olagandisi = -(grup("67") + grup("68"));
    v.vergiOncesi = -(["60", "61", "62", "63", "64", "65", "66", "67", "68"].reduce(function (t, g) { return t + grup(g); }, 0));
    v.maddi = ["250", "251", "252", "253", "254", "255", "256"].reduce(function (t, k) { return t + b(k); }, 0);
    v.birikmis = -b("257");
    v.toplam = Object.keys(h).reduce(function (t, k) { return t + h[k]; }, 0);
    v.yedi = grup("7");
    v.aylikSatis = v.netSatis / ay;

    var bolumler = [];
    var uyarilar = [];
    function satir(bolum, ad, deger, durum, yorum) { bolum.satirlar.push({ ad: ad, deger: deger, durum: durum, yorum: yorum }); }
    function bolum(ad) { var o = { ad: ad, satirlar: [] }; bolumler.push(o); return o; }
    function seviye(x, iyi, dikkat, buyukIyi) {
      if (x == null || !isFinite(x)) return "bilgi";
      return buyukIyi ? (x >= iyi ? "iyi" : x >= dikkat ? "dikkat" : "risk") : (x <= iyi ? "iyi" : x <= dikkat ? "dikkat" : "risk");
    }
    var bol = function (a, c) { return c ? a / c + 0 : null; };

    // Likidite
    var L = bolum("Likidite");
    var cari = bol(v.donen, v.kvyk), asit = bol(v.donen - v.stok, v.kvyk), nakitO = bol(v.hazir, v.kvyk);
    satir(L, "Cari oran", cari == null ? "—" : ondalik.format(cari), seviye(cari, 1.5, 1, true),
      "Dönen varlıkların kısa vadeli borçları kaç kez karşıladığı. 1,5 ve üzeri rahat; 1'in altı kısa vadeli borçların dönen varlıklarla karşılanamadığını gösterir.");
    satir(L, "Asit-test oranı", asit == null ? "—" : ondalik.format(asit), seviye(asit, 1, 0.7, true),
      "Stoklar hariç dönen varlıkların kısa vadeli borçlara oranı. Stok satılmadan borçların ne kadarının ödenebileceğini gösterir.");
    satir(L, "Nakit oranı", nakitO == null ? "—" : ondalik.format(nakitO), seviye(nakitO, 0.2, 0.1, true),
      "Kasa, banka ve benzeri hazır değerlerin kısa vadeli borçlara oranı.");

    // Borçluluk
    var B = bolum("Borçluluk ve sermaye yapısı");
    var finBorc = v.kvFin + v.uvFin;
    var kaldirac = bol(v.kvyk + v.uvyk, v.aktif), finOz = bol(finBorc, v.ozkaynak), kvPay = finBorc > 0 ? v.kvFin / finBorc : null;
    satir(B, "Toplam borç / aktif", kaldirac == null ? "—" : yuzde.format(kaldirac), seviye(kaldirac, 0.6, 0.75, false),
      "Varlıkların ne kadarının borçla finanse edildiği.");
    satir(B, "Finansal borç / özkaynak", v.ozkaynak <= 0 ? "Özkaynak negatif" : ondalik.format(finOz), v.ozkaynak <= 0 ? "risk" : seviye(finOz, 1, 2, false),
      "Banka kredilerinin özkaynağa oranı. Bankaların kredi değerlendirmesinde ilk baktığı oranlardandır.");
    satir(B, "Kısa vadeli banka kredisi payı", kvPay == null ? "Banka kredisi yok" : yuzde.format(kvPay), kvPay == null ? "bilgi" : seviye(kvPay, 0.6, 0.8, false),
      "Banka kredilerinin ne kadarının bir yıl içinde ödeneceği. Yüksek pay, yatırımların ya da kalıcı ihtiyaçların kısa vadeli krediyle finanse edildiğine işaret edebilir.");
    if (v.ozkaynak <= 0) uyarilar.push(["risk", "Özkaynak negatif görünüyor. Sermaye kaybı ve borca batıklık açısından mali müşavirinizle acilen değerlendirin."]);

    // Faaliyet ve kârlılık
    var F = bolum("Faaliyet ve kârlılık (" + ay + " aylık)");
    satir(F, "Net satışlar", M(v.netSatis), "bilgi", "Satışlardan iade ve iskontolar düşüldükten sonraki tutar.");
    var bm = bol(v.brut, v.netSatis), fm = bol(v.faalKar, v.netSatis), nm = bol(v.vergiOncesi, v.netSatis);
    satir(F, "Brüt kâr marjı", bm == null ? "—" : yuzde.format(bm), bm == null ? "bilgi" : bm < 0 ? "risk" : bm < 0.1 ? "dikkat" : "iyi",
      "Satışların maliyeti düşüldükten sonra kalan pay. Sektöre göre değişir; asıl önemli olan yıllar içindeki eğilimidir.");
    satir(F, "Faaliyet kârı", M(v.faalKar) + (fm != null ? " (" + yuzde.format(fm) + ")" : ""), v.faalKar < 0 ? "risk" : fm != null && fm < 0.03 ? "dikkat" : "iyi",
      "İşletmenin asıl işinden kazandığı: brüt kâr eksi pazarlama, genel yönetim ve Ar-Ge giderleri.");
    satir(F, "Faaliyet dışı gelir − gider", M(v.digerGelir - v.digerGider - v.finGider + v.olagandisi), "bilgi",
      "Faiz, kur farkı, destek, finansman gideri ve olağandışı kalemlerin net etkisi.");
    satir(F, "Dönem sonucu (vergi öncesi)", M(v.vergiOncesi) + (nm != null ? " (" + yuzde.format(nm) + ")" : ""), v.vergiOncesi < 0 ? "risk" : "iyi",
      "Tüm gelir ve giderler sonrası kalan.");
    if (v.faalKar < 0 && v.vergiOncesi > 0) uyarilar.push(["dikkat", "İşletme asıl faaliyetinden zarar ediyor; dönem kârı faaliyet dışı gelirlerden (faiz, kur farkı, destek vb.) geliyor. Bu gelirlerin sürekliliği sorgulanmalı."]);
    if (Math.abs(v.yedi) > 1 && v.smm === 0 && v.faalGider === 0) uyarilar.push(["bilgi", "7'li maliyet hesapları 6'lı hesaplara aktarılmamış görünüyor; brüt kâr ve faaliyet kârı bu yüzden olduğundan farklı hesaplanmış olabilir. Dönem sonucu yine doğrudur."]);

    // İşletme sermayesi
    var I = bolum("İşletme sermayesi döngüsü");
    var ag = v.netSatis > 0 ? v.ticAlacak / v.netSatis * gunSay : null;
    var sg = v.smm > 0 ? v.stok / v.smm * gunSay : null;
    var bg = v.smm > 0 ? v.ticBorc / v.smm * gunSay : null;
    satir(I, "Alacak tahsil süresi", ag == null ? "—" : tl.format(ag) + " gün", ag == null ? "bilgi" : ag > 120 ? "risk" : ag > 75 ? "dikkat" : "iyi",
      "Ticari alacakların ortalama kaç günlük satışa denk geldiği. Verdiğiniz vadeyle karşılaştırın; fark, müşterilerinize finanse ettiğiniz süredir.");
    satir(I, "Stok devir süresi", sg == null ? "—" : tl.format(sg) + " gün", sg == null ? "bilgi" : sg > 120 ? "risk" : sg > 75 ? "dikkat" : "iyi",
      "Stokların kaç günlük satış maliyetine yettiği.");
    satir(I, "Borç ödeme süresi", bg == null ? "—" : tl.format(bg) + " gün", "bilgi",
      "Ticari borçların kaç günlük satış maliyetine denk geldiği.");
    if (ag != null && sg != null && bg != null) {
      var nds = ag + sg - bg;
      satir(I, "Nakit dönüşüm süresi", tl.format(nds) + " gün", nds > 120 ? "risk" : nds > 60 ? "dikkat" : "iyi",
        "Alacak + stok − borç süresi. Bir liranın işletmeye geri dönmesi için geçen süre; uzadıkça finansman ihtiyacı artar.");
    }

    // Özel kontroller
    var K = bolum("Özel kontroller");
    if (v.kasa < 0) {
      satir(K, "Kasa", M(v.kasa), "risk", "Kasa hesabı alacak bakiyesi veriyor; fiilen mümkün değildir, kayıt hatası vardır.");
      uyarilar.push(["risk", "Kasa hesabı eksi bakiye veriyor. Kayıtlar kontrol edilmeli."]);
    } else {
      var kasaYuksek = v.aylikSatis > 0 && v.kasa > v.aylikSatis * 0.1;
      satir(K, "Kasa bakiyesi", M(v.kasa), kasaYuksek ? "dikkat" : "iyi",
        kasaYuksek ? "Kasa bakiyesi aylık satışların %10'unu aşıyor. Fiili kasa sayımıyla tutmuyorsa kaydı yapılmamış ödemeler ya da ortak çekişleri kasada bekliyor olabilir; vergi incelemelerinde ilk sorulan konulardandır." : "Makul düzeyde.");
      if (kasaYuksek) uyarilar.push(["dikkat", "Kasa bakiyesi yüksek (" + M(v.kasa) + "). Fiili kasa sayımıyla karşılaştırın."]);
    }
    var ortakOran = v.ozkaynak > 0 ? v.ortakAlacak / v.ozkaynak : null;
    if (v.ortakAlacak > 0) {
      var od = ortakOran == null || ortakOran > 0.25 ? "risk" : ortakOran > 0.1 ? "dikkat" : "iyi";
      satir(K, "Ortaklardan alacaklar", M(v.ortakAlacak) + (ortakOran != null ? " (özkaynağın " + yuzde.format(ortakOran) + ")" : ""), od,
        "Ortaklara verilmiş ve geri dönmemiş para. Adat (faiz) hesaplanması gerekebilir; bankalar kredi değerlendirmesinde bu hesaba özellikle bakar.");
      if (od !== "iyi") uyarilar.push([od, "Ortaklardan alacaklar " + M(v.ortakAlacak) + ". Adat hesabı ve kredi değerlendirmesi açısından gözden geçirin."]);
    } else satir(K, "Ortaklardan alacaklar", "Yok", "iyi", "");
    if (v.kdv > 0) {
      var kdvYuksek = v.kdv > v.aktif * 0.03 || (v.aylikSatis > 0 && v.kdv > v.aylikSatis * 0.5);
      satir(K, "Devreden KDV", M(v.kdv), kdvYuksek ? "dikkat" : "iyi",
        "Ödenmiş ama henüz mahsup edilememiş KDV; faizsiz olarak bağlanmış işletme sermayesidir. İade veya mahsup imkânları değerlendirilmeli.");
      if (kdvYuksek) uyarilar.push(["dikkat", "Devreden KDV yüksek (" + M(v.kdv) + "). Bu tutar işletme sermayesini bağlıyor."]);
    }
    if (v.maddi > 0) {
      var amorOran = v.birikmis / v.maddi;
      var amorDurum = v.birikmis <= 0 ? "risk" : amorOran < 0.1 ? "dikkat" : "iyi";
      satir(K, "Birikmiş amortisman", v.birikmis <= 0 ? "Yok" : M(v.birikmis) + " (maddi varlıkların " + yuzde.format(amorOran) + ")", amorDurum,
        v.birikmis <= 0 ? "Maddi duran varlık var ama birikmiş amortisman görünmüyor. Amortisman ayrılmamış olabilir; bu durumda kâr ve varlıklar olduğundan yüksek görünür." :
          "Maddi duran varlıklar için ayrılmış amortisman.");
      if (amorDurum === "risk") uyarilar.push(["risk", "Birikmiş amortisman görünmüyor. Amortisman ayrılmamışsa kâr olduğundan yüksek görünür."]);
    }
    if (v.banka < 0) satir(K, "Bankalar", M(v.banka), "dikkat", "Banka hesabı alacak bakiyesi veriyor (kredili mevduat ya da kayıt hatası).");
    var denge = Math.abs(v.toplam) <= Math.max(1, Math.abs(v.aktif) * 0.0001);
    satir(K, "Mizan dengesi", denge ? "Borç = alacak" : "Fark: " + M(v.toplam), denge ? "iyi" : "dikkat",
      denge ? "Borç ve alacak bakiyeleri toplamı eşit." : "Borç ve alacak toplamları tutmuyor. Dosya eksik olabilir ya da bazı hesaplar okunamamış olabilir; sonuçlar bu farkla birlikte değerlendirilmeli.");
    if (!denge) uyarilar.push(["dikkat", "Mizan borç ve alacak toplamları birbirini tutmuyor (fark " + M(v.toplam) + "). Dosyanın tamamının okunduğundan emin olun."]);

    return { v: v, bolumler: bolumler, uyarilar: uyarilar, ay: ay };
  }

  // ------------------------------------------------------------ Gösterim
  var ETIKET = { iyi: "Olumlu", dikkat: "Dikkat", risk: "Risk", bilgi: "Bilgi" };
  function goster(m, kaynakAdi) {
    var ay = parseInt($("#ay").value, 10) || 12;
    var s = analiz(m, ay);
    son = { m: m, ad: kaynakAdi };
    var v = s.v;
    var sayac = { risk: 0, dikkat: 0, iyi: 0 };
    s.bolumler.forEach(function (b) { b.satirlar.forEach(function (r) { if (sayac[r.durum] != null) sayac[r.durum]++; }); });
    $("#sonuc").hidden = false;
    $("#kaynak").textContent = kaynakAdi + " · " + Object.keys(m.hesap).length + " ana hesap · " + ay + " aylık dönem";
    $("#ana-rakam").innerHTML = [["Aktif toplamı", M(v.aktif)], ["Özkaynak", M(v.ozkaynak)], ["Net satışlar", M(v.netSatis)],
      ["Faaliyet kârı", M(v.faalKar)], ["Dönem sonucu", M(v.vergiOncesi)]].map(function (x) {
        return "<div><span>" + x[0] + "</span><strong" + (/^-/.test(x[1]) ? ' class="kirmizi"' : "") + ">" + x[1] + "</strong></div>";
      }).join("");
    $("#sayac").innerHTML = '<span class="d-risk">' + sayac.risk + " risk</span><span class=\"d-dikkat\">" + sayac.dikkat +
      " dikkat</span><span class=\"d-iyi\">" + sayac.iyi + " olumlu</span>";
    $("#uyarilar").innerHTML = s.uyarilar.length ? "<h3>Öne çıkan bulgular</h3><ul>" + s.uyarilar.map(function (u) {
      return '<li class="d-' + u[0] + '">' + esc(u[1]) + "</li>";
    }).join("") + "</ul>" : "<h3>Öne çıkan bulgular</h3><p>Belirgin bir uyarı çıkmadı. Ayrıntılar aşağıda.</p>";
    $("#bolumler").innerHTML = s.bolumler.map(function (b) {
      return '<section class="rontgen-bolum"><h3>' + esc(b.ad) + "</h3>" + b.satirlar.map(function (r) {
        return '<div class="r-satir"><div class="r-ad">' + esc(r.ad) + '</div><div class="r-deger">' + esc(r.deger) +
          '</div><div class="r-durum d-' + r.durum + '">' + ETIKET[r.durum] + '</div><div class="r-yorum">' + esc(r.yorum) + "</div></div>";
      }).join("") + "</section>";
    }).join("");
    $("#sonuc").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dosyaOku(d) {
    if (!window.XLSX) { alert("Excel kütüphanesi yüklenemedi; sayfayı yenileyip tekrar deneyin."); return; }
    $("#dosya-durum").textContent = d.name + " okunuyor…";
    d.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: "array" });
      var enIyi = null;
      wb.SheetNames.forEach(function (ad) {
        var m = mizanOku(XLSX.utils.sheet_to_json(wb.Sheets[ad], { header: 1, raw: true, defval: "" }));
        if (!enIyi || Object.keys(m.hesap).length > Object.keys(enIyi.hesap).length) enIyi = m;
      });
      if (!enIyi || Object.keys(enIyi.hesap).length < 5) {
        $("#dosya-durum").textContent = "Dosyada mizan bulunamadı.";
        alert("Dosyada hesap kodu ve borç/alacak bakiyesi sütunları bulunamadı. Başlık satırında 'Hesap Kodu', 'Borç Bakiye' ve 'Alacak Bakiye' (ya da 'Borç' ve 'Alacak') geçmelidir.");
        return;
      }
      $("#dosya-durum").textContent = d.name + " okundu.";
      goster(enIyi, d.name);
    }).catch(function () { $("#dosya-durum").textContent = "Dosya okunamadı."; });
  }

  // ------------------------------------------------------------ Örnek (kurgusal, 9 aylık)
  var ORNEK = [
    ["Hesap Kodu", "Hesap Adı", "Borç Bakiye", "Alacak Bakiye"],
    ["100", "Kasa", 1850000, 0], ["102", "Bankalar", 2400000, 0], ["120", "Alıcılar", 18500000, 0],
    ["121", "Alacak Senetleri", 2100000, 0], ["131", "Ortaklardan Alacaklar", 4200000, 0], ["150", "İlk Madde ve Malzeme", 6800000, 0],
    ["152", "Mamuller", 3900000, 0], ["153", "Ticari Mallar", 1200000, 0], ["190", "Devreden KDV", 3300000, 0],
    ["252", "Binalar", 9000000, 0], ["253", "Tesis, Makine ve Cihazlar", 14500000, 0], ["254", "Taşıtlar", 3200000, 0],
    ["300", "Banka Kredileri", 0, 14800000], ["320", "Satıcılar", 0, 11600000], ["321", "Borç Senetleri", 0, 1900000],
    ["335", "Personele Borçlar", 0, 900000], ["360", "Ödenecek Vergi ve Fonlar", 0, 750000], ["361", "Ödenecek Sosyal Güvenlik Kesintileri", 0, 620000],
    ["400", "Banka Kredileri", 0, 6500000], ["500", "Sermaye", 0, 10000000], ["570", "Geçmiş Yıllar Kârları", 0, 23230000],
    ["600", "Yurtiçi Satışlar", 0, 52000000], ["601", "Yurtdışı Satışlar", 0, 4000000], ["610", "Satıştan İadeler", 900000, 0],
    ["620", "Satılan Mamuller Maliyeti", 43500000, 0], ["631", "Pazarlama Satış ve Dağıtım Giderleri", 3100000, 0],
    ["632", "Genel Yönetim Giderleri", 9400000, 0], ["642", "Faiz Gelirleri", 0, 650000], ["646", "Kambiyo Kârları", 0, 1900000],
    ["649", "Diğer Olağan Gelir ve Kârlar", 0, 3800000], ["656", "Kambiyo Zararları", 700000, 0], ["660", "Kısa Vadeli Borçlanma Giderleri", 4100000, 0]
  ];

  document.addEventListener("DOMContentLoaded", function () {
    var alan = $("#yukle"), girdi = $("#dosya");
    girdi.addEventListener("change", function () { if (girdi.files[0]) dosyaOku(girdi.files[0]); });
    ["dragenter", "dragover"].forEach(function (o) { alan.addEventListener(o, function (e) { e.preventDefault(); alan.classList.add("ustunde"); }); });
    ["dragleave", "drop"].forEach(function (o) { alan.addEventListener(o, function (e) { e.preventDefault(); alan.classList.remove("ustunde"); }); });
    alan.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) dosyaOku(e.dataTransfer.files[0]); });
    $("#ornek").addEventListener("click", function () {
      $("#ay").value = "9";
      $("#dosya-durum").textContent = "Örnek mizan yüklendi (kurgusal, 9 aylık).";
      goster(mizanOku(ORNEK), "Örnek mizan");
    });
    $("#ay").addEventListener("change", function () { if (son) goster(son.m, son.ad); });
    $("#yazdir").addEventListener("click", function () { window.print(); });
    if (/[?&]ornek=1/.test(location.search)) $("#ornek").click();
  });
})();
