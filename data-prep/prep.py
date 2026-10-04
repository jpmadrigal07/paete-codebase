# Build the real-world data files for the Paete site (local metric frame centred on the church).
import json, math, os, urllib.request, io
from PIL import Image

OUT = "../site"
os.makedirs(OUT, exist_ok=True)
LAT0, LON0 = 14.364553, 121.4817725
MX = 111320 * math.cos(math.radians(LAT0))
MY = 110574

def to_local(lat, lon):
    return ((lon - LON0) * MX, -(lat - LAT0) * MY)  # x east, z south

def to_ll(x, z):
    return (LAT0 - z / MY, LON0 + x / MX)

def merc(lat, lon, zoom):
    n = 2 ** zoom
    lr = math.radians(lat)
    return ((lon + 180) / 360 * n, (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n)

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "paete-site-builder/1.0"})
    return urllib.request.urlopen(req, timeout=60).read()

class Mosaic:
    """Tiles at one zoom, sampled bilinearly by lat/lon."""
    def __init__(self, zoom, x0, x1, y0, y1, kind):
        self.zoom, self.x0, self.y0 = zoom, x0, y0
        W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
        self.img = Image.new("RGB", (W, H))
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                cache = f"cache_{kind}_{zoom}_{tx}_{ty}"
                if not os.path.exists(cache):
                    url = (f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png" if kind == "dem"
                           else f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{zoom}/{ty}/{tx}.jpg")
                    open(cache, "wb").write(fetch(url))
                self.img.paste(Image.open(cache).convert("RGB"), ((tx - x0) * 256, (ty - y0) * 256))
        self.px = self.img.load()
        self.W, self.H = W, H
        self.kind = kind

    def raw(self, x, y):
        x = min(max(x, 0), self.W - 1); y = min(max(y, 0), self.H - 1)
        r, g, b = self.px[x, y]
        return r * 256 + g + b / 256 - 32768 if self.kind == "dem" else (r, g, b)

    def sample(self, lat, lon):
        mx, my = merc(lat, lon, self.zoom)
        fx, fy = (mx - self.x0) * 256 - 0.5, (my - self.y0) * 256 - 0.5
        ix, iy = math.floor(fx), math.floor(fy)
        ax, ay = fx - ix, fy - iy
        a, b, c, d = self.raw(ix, iy), self.raw(ix + 1, iy), self.raw(ix, iy + 1), self.raw(ix + 1, iy + 1)
        if self.kind == "dem":
            return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay
        return tuple(int((a[k] * (1 - ax) + b[k] * ax) * (1 - ay) + (c[k] * (1 - ax) + d[k] * ax) * ay) for k in range(3))

def tiles_for(zoom, lat_s, lat_n, lon_w, lon_e):
    x0, y0 = merc(lat_n, lon_w, zoom); x1, y1 = merc(lat_s, lon_e, zoom)
    return int(x0), int(x1), int(y0), int(y1)

def encode_heights(grid_w, grid_h, fn, name):
    img = Image.new("RGB", (grid_w, grid_h)); p = img.load()
    lo, hi = 1e9, -1e9
    for j in range(grid_h):
        for i in range(grid_w):
            h = fn(i, j)
            lo, hi = min(lo, h), max(hi, h)
            v = int(round((h + 100) * 50))  # 2 cm steps, offset -100 m
            v = max(0, min(65535, v))
            p[i, j] = (v >> 8, v & 255, 0)
    img.save(f"{OUT}/{name}")
    return lo, hi

LAKE = 2.0
# ---------------- detail terrain ----------------
DX0, DX1, DZ0, DZ1 = -3600, 4400, -2800, 2800   # metres
GW, GH = 501, 351                                 # 16 m spacing
lat_n, lon_w = to_ll(DX0, DZ0); lat_s, lon_e = to_ll(DX1, DZ1)
demD = Mosaic(14, *tiles_for(14, lat_s, lat_n, lon_w, lon_e), "dem")
def hD(i, j):
    x = DX0 + (DX1 - DX0) * i / (GW - 1); z = DZ0 + (DZ1 - DZ0) * j / (GH - 1)
    h = demD.sample(*to_ll(x, z))
    return -4.0 if h <= LAKE + 0.06 else h
print("detail heights", encode_heights(GW, GH, hD, "terrain.png"))

imgD = Mosaic(15, *tiles_for(15, lat_s, lat_n, lon_w, lon_e), "img")
TW, TH = 2048, 1434
sat = Image.new("RGB", (TW, TH)); sp = sat.load()
for j in range(TH):
    for i in range(TW):
        x = DX0 + (DX1 - DX0) * (i + 0.5) / TW; z = DZ0 + (DZ1 - DZ0) * (j + 0.5) / TH
        sp[i, j] = imgD.sample(*to_ll(x, z))
sat.save(f"{OUT}/satellite.jpg", quality=86)

# ---------------- context terrain ----------------
CX0, CX1, CZ0, CZ1 = -18000, 14000, -12000, 12000
CW, CH = 257, 193                                # 125 m spacing
lat_n2, lon_w2 = to_ll(CX0, CZ0); lat_s2, lon_e2 = to_ll(CX1, CZ1)
demC = Mosaic(11, *tiles_for(11, lat_s2, lat_n2, lon_w2, lon_e2), "dem")
def hC(i, j):
    x = CX0 + (CX1 - CX0) * i / (CW - 1); z = CZ0 + (CZ1 - CZ0) * j / (CH - 1)
    h = demC.sample(*to_ll(x, z))
    if DX0 + 60 < x < DX1 - 60 and DZ0 + 60 < z < DZ1 - 60: h -= 40  # tuck under the detail terrain
    return -4.0 if h <= LAKE + 0.3 else h
print("context heights", encode_heights(CW, CH, hC, "context.png"))
imgC = Mosaic(12, *tiles_for(12, lat_s2, lat_n2, lon_w2, lon_e2), "img")
cs = Image.new("RGB", (1024, 768)); cp = cs.load()
for j in range(768):
    for i in range(1024):
        x = CX0 + (CX1 - CX0) * (i + 0.5) / 1024; z = CZ0 + (CZ1 - CZ0) * (j + 0.5) / 768
        cp[i, j] = imgC.sample(*to_ll(x, z))
cs.save(f"{OUT}/context.jpg", quality=84)

# ---------------- OSM vectors ----------------
osm = json.load(open("osm.json"))
def inside(x, z, m=0): return DX0 + m < x < DX1 - m and DZ0 + m < z < DZ1 - m
buildings, roads, streams = [], [], []
trail = None
CHURCH_ID = 699522813
church = None
for e in osm["elements"]:
    t = e.get("tags", {}); g = e.get("geometry")
    if not g: continue
    pts = [to_local(p["lat"], p["lon"]) for p in g]
    rp = [[round(x, 1), round(z, 1)] for x, z in pts]
    if e["id"] == CHURCH_ID:
        church = rp; continue
    if "building" in t and e["type"] == "way" and len(pts) >= 4:
        cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
        if not inside(cx, cz, 100): continue
        lv = t.get("building:levels")
        buildings.append({"p": rp[:-1], "l": int(float(lv)) if lv and lv.replace('.', '', 1).isdigit() else 0, "k": t.get("building")})
    elif "highway" in t and e["type"] == "way":
        if e["id"] == 699690153: trail = rp; continue
        hw = t["highway"]
        w = {"primary": 8, "primary_link": 6, "secondary": 7, "tertiary": 6, "residential": 4.5, "unclassified": 4.5, "service": 3.5, "pedestrian": 4, "track": 3}.get(hw, 1.8)
        if all(not inside(x, z, 50) for x, z in pts): continue
        roads.append({"p": rp, "w": w, "k": hw})
    elif t.get("waterway") in ("river", "stream") and e["type"] == "way":
        if all(not inside(x, z, 50) for x, z in pts): continue
        streams.append({"p": rp, "w": 6 if t["waterway"] == "river" else 2.5})
site = next(e for e in osm["elements"] if e["id"] == 96046902)
spts = [to_local(p["lat"], p["lon"]) for p in site["geometry"]]
krus = [round(sum(p[0] for p in spts) / len(spts), 1), round(sum(p[1] for p in spts) / len(spts), 1)]
krus_poly = [[round(x, 1), round(z, 1)] for x, z in spts]
sembrano = [round(v, 1) for v in to_local(14.385076, 121.3659025)]
data = {
    "frame": {"lat0": LAT0, "lon0": LON0, "lake": LAKE},
    "detail": {"x0": DX0, "x1": DX1, "z0": DZ0, "z1": DZ1, "w": GW, "h": GH},
    "context": {"x0": CX0, "x1": CX1, "z0": CZ0, "z1": CZ1, "w": CW, "h": CH},
    "church": church, "krus": krus, "krusPoly": krus_poly, "trail": trail, "sembrano": sembrano,
    "buildings": buildings, "roads": roads, "streams": streams,
}
json.dump(data, open(f"{OUT}/paete.json", "w"), separators=(",", ":"))
print("buildings", len(buildings), "roads", len(roads), "streams", len(streams), "trail pts", len(trail), "krus", krus, "sembrano", sembrano)
print("church", church)
