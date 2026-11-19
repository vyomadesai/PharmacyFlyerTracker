// Build a standalone interactive Leaflet map of the route (no runtime deps).

export function buildMapHTML(stops, title, gmaps = "") {
  const data = stops.map((s) => ({
    order: s.stop_order,
    lat: s.lat,
    lon: s.lon,
    address: `${s.address}, ${s.city} ${s.zip}`,
    arrive: s.arrive,
    depart: s.depart,
    drive: s.drive_min_from_prev,
    num: s.num_doctors,
    doctors: s.doctor_names,
  }));
  const payload = JSON.stringify(data);
  const glink = gmaps
    ? ` &mdash; <a href="${gmaps}" target="_blank">Open in Google Maps</a>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body{margin:0;height:100%;font-family:system-ui,Arial,sans-serif}
  #map{height:100%}
  .pin{background:#1e66f5;color:#fff;border-radius:50%;width:26px;height:26px;
       line-height:26px;text-align:center;font-weight:700;font-size:13px;
       border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5)}
  .pin.start{background:#2e7d32}.pin.end{background:#c62828}
  #hdr{position:absolute;z-index:1000;top:10px;left:50px;background:#fff;
       padding:8px 12px;border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.3);
       font-size:13px;max-width:60%}
  #hdr a{color:#1e66f5}
</style></head><body>
<div id="hdr"><b>${title}</b>${glink}</div>
<div id="map"></div>
<script>
var stops = ${payload};
var map = L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(map);
var pts=[], bounds=[];
stops.forEach(function(s,i){
  var ll=[s.lat,s.lon]; pts.push(ll); bounds.push(ll);
  var cls='pin'+(i===0?' start':'')+(i===stops.length-1?' end':'');
  var icon=L.divIcon({className:'',html:'<div class="'+cls+'">'+s.order+'</div>',
    iconSize:[26,26],iconAnchor:[13,13]});
  L.marker(ll,{icon:icon}).addTo(map).bindPopup(
    '<b>Stop '+s.order+'</b><br>'+s.address+
    '<br>Arrive '+s.arrive+' &middot; Depart '+s.depart+
    '<br>Drive from prev: '+s.drive+' min'+
    '<br>Doctors ('+s.num+'): '+s.doctors);
});
L.polyline(pts,{color:'#1e66f5',weight:3,opacity:.7,dashArray:'6,6'}).addTo(map);
map.fitBounds(bounds,{padding:[40,40]});
</script></body></html>`;
}
