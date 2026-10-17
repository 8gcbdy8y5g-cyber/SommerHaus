# Holt die Abfuhrtermine vom USB Bochum (Müllmax) und schreibt muell.json.
# Die Adresse steht verschlüsselt in geheim.enc. In muell.json landen nur Daten, keine Adresse.
import json, re, sys, datetime, requests
MONTHS = [1, 7]  # Januar und Juli: dann seid ihr mit den Tonnen dran
KIND = {'Grau': 'black', 'Blau': 'blue', 'Gelb': 'yellow'}
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537"}
URL = "https://www.muellmax.de/abfallkalender/usb/res/UsbStart.php"

sec = json.load(open(sys.argv[1]))
s = requests.Session()
def ses(t):
    m = re.search(r'name="mm_ses"[^>]*value="([^"]*)"', t) or re.search(r'value="([^"]*)"[^>]*name="mm_ses"', t)
    return m.group(1) if m else None
def post(a):
    r = s.post(URL, data=a, headers=H, timeout=30); r.raise_for_status()
    if 'Abfragelimit' in r.text: sys.exit('Müllmax: Abfragelimit erreicht, nächste Woche wieder')
    return r.text
t = s.get(URL, headers=H, timeout=30).text; S = ses(t)
t = post({"mm_ses": S, "mm_aus_ort.x": 0, "mm_aus_ort.y": 0}); S = ses(t) or S
t = post({"mm_ses": S, "xxx": 1, "mm_frm_str_name": sec['street'], "mm_aus_str_txt_submit": "suchen"}); S = ses(t) or S
if 'name="mm_frm_str_sel"' in t:
    st = [o for o in re.findall(r'<option[^>]*value="([^"]+)"', t) if o.lower().startswith(sec['street'].lower()[:6])]
    t = post({"mm_ses": S, "xxx": 1, "mm_frm_str_sel": st[0], "mm_aus_str_sel_submit": "weiter"}); S = ses(t) or S
if "mm_frm_hnr_sel" in t:
    h = [o for o in re.findall(r'<option[^>]*value="([^"]+)"', t) if o.split(';')[2:3] == [sec['hnr']] or o == sec['hnr']]
    t = post({"mm_ses": S, "xxx": 1, "mm_frm_hnr_sel": h[0], "mm_aus_hnr_sel_submit": "weiter"}); S = ses(t) or S
t = post({"mm_ses": S, "xxx": 1, "mm_ica_auswahl": "iCalendar-Datei"}); S = ses(t) or S
fra = dict(re.findall(r'name="(mm_frm_fra[^"]*)"[^>]*value="([^"]*)"', t))
if not fra: sys.exit('Müllmax: keine Tonnenarten gefunden')
a = {"mm_ses": S, "xxx": 1, "mm_frm_type": "termine"}; a.update(fra); a["mm_ica_gen"] = "iCalendar-Datei laden"
ics = post(a)
if 'BEGIN:VCALENDAR' not in ics: sys.exit('Müllmax: keine Kalenderdatei bekommen')

found = []
for ev in ics.split('BEGIN:VEVENT')[1:]:
    d = re.search(r'DTSTART[^:]*:(\d{8})', ev); m = re.search(r'SUMMARY:USB Abfuhr (\w+)', ev)
    if d and m and m.group(1) in KIND:
        x = d.group(1); found.append((KIND[m.group(1)], f'{x[:4]}-{x[4:6]}-{x[6:]}'))
try: old = json.load(open('muell.json'))
except Exception: old = {'dates': {}}
today = datetime.date.today().isoformat()
dates = {k: sorted(set([v for v in old.get('dates', {}).get(k, []) if v >= today] + [v for kk, v in found if kk == k and int(v[5:7]) in MONTHS])) for k in KIND.values()}
out = {'source': 'USB Bochum (Müllmax)', 'months': MONTHS, 'dates': dates, 'seenUntil': max([v for _, v in found], default='')}
if {k: old.get(k) for k in ('months', 'dates', 'seenUntil')} == {k: out[k] for k in ('months', 'dates', 'seenUntil')}:
    print('unverändert'); sys.exit(0)
out['updated'] = today
json.dump(out, open('muell.json', 'w'), ensure_ascii=False, indent=1)
print('neu:', {k: len(v) for k, v in dates.items()}, 'bekannt bis', out['seenUntil'])
