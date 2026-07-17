# Own Stream Portal

Deck de control para streaming en el navegador (reemplazo de Touch Portal).
Un servidor Node.js corre en el PC de streaming y sirve una cuadricula de
botones a cualquier navegador (movil, tablet u otro PC) en la red local.

**La ventaja clave**: el layout vive en `deck.config.json`. Al guardar el
archivo, todos los navegadores conectados se actualizan al instante — sin
apps moviles que se queden con botones viejos.

## Que puede hacer un boton

| Accion | Que hace |
|---|---|
| `obs.scene` | Cambiar la escena de OBS |
| `obs.sourceVisibility` | Mostrar/ocultar una fuente de una escena |
| `obs.filter` | Activar/desactivar un filtro |
| `obs.mute` | Mutear/desmutear un input de audio (mic, musica...) |
| `obs.stream` / `obs.record` | Iniciar/parar stream o grabacion |
| `obs.raw` | Cualquier request de obs-websocket v5 (escape hatch) |
| `keys.hotkey` | Enviar un atajo de teclado (`"ctrl+shift+f10"`) a la ventana activa |
| `keys.text` | Escribir texto en la ventana activa |
| `media` | Teclas multimedia: `playpause`, `next`, `prev`, `stop` |
| `volume` | Volumen maestro de Windows: `up`, `down`, `mute` |
| `launch.app` / `launch.url` | Abrir un programa o una URL |
| `macro` | Secuencia de acciones con pausas (`delayMs`) |

Los botones OBS muestran estado en vivo: la escena activa lleva un anillo
azul, el mic muteado se marca en rojo, grabar/stream se iluminan cuando
estan activos — aunque el cambio se haga desde OBS.

## Requisitos

- Windows 10/11 con [Node.js 22+](https://nodejs.org)
- OBS Studio 28+ (el servidor WebSocket ya viene integrado)

## Puesta en marcha

1. **OBS**: `Herramientas → Ajustes del servidor WebSocket` → activa el
   servidor, puerto 4455, y copia la password (`Mostrar contraseña`).

2. **Configura el proyecto**:

   ```
   cd own_stream_portal
   npm install
   copy .env.example .env
   ```

   Edita `.env`: pega la password de OBS en `OBS_PASSWORD` y pon un PIN
   en `DECK_TOKEN` (si lo dejas vacio se genera uno nuevo en cada
   arranque).

3. **Arranca**:

   ```
   npm start
   ```

4. **En el movil** (misma red Wi-Fi): escanea el QR de la consola. Para
   tenerlo como app: menu de Chrome → *Añadir a pantalla de inicio*.

### Navegacion entre paginas

Toca las pestañas de arriba, **desliza el dedo a izquierda/derecha** sobre
la cuadricula, o usa las flechas ← → del teclado (en PC). Deslizar no
activa el boton que hay debajo del dedo.

### Firewall de Windows

La primera vez Windows preguntara si permites conexiones — marca *Redes
privadas* y acepta. Si cerraste el aviso sin querer y el movil no conecta:

```
netsh advfirewall firewall add rule name="Own Stream Portal" dir=in action=allow protocol=TCP localport=8420
```

## Editar los botones

Todo esta en `deck.config.json`. Guarda el archivo y el movil se
actualiza solo (~1 segundo). Si guardas un JSON invalido, el servidor
avisa en consola con la ruta exacta del error y sigue funcionando con el
layout anterior.

Ejemplo de boton:

```json
{
    "id": "scene-en-vivo",
    "label": "En Vivo",
    "icon": "🔴",
    "color": "#dc2626",
    "action": { "type": "obs.scene", "scene": "En Vivo" }
}
```

- `id`: unico en todo el archivo. `icon`: cualquier emoji. `color`: hex opcional.
- Los botones se colocan en orden; `{ "type": "spacer" }` deja un hueco,
  y `"position": { "col": 2, "row": 1 }` fuerza una celda concreta.
- Cada pagina define su cuadricula: `"grid": { "cols": 4, "rows": 3 }`.
- Los nombres de escenas/inputs/fuentes deben coincidir **exactamente**
  con los de OBS.

Macro de ejemplo (mutea el mic, espera y cambia de escena):

```json
{
    "type": "macro",
    "steps": [
        { "action": { "type": "obs.mute", "input": "Mic/Aux", "mute": true } },
        { "delayMs": 300 },
        { "action": { "type": "obs.scene", "scene": "Ya Vuelvo" } }
    ]
}
```

## Acceso desde fuera de casa (Cloudflare Tunnel)

Con el servidor corriendo:

```
npm run tunnel
```

Necesita [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(`winget install Cloudflare.cloudflared`). El script imprime una URL
publica `https://...trycloudflare.com` con el token incluido y su QR.
El token protege el deck: sin el, cualquier visitante recibe un 403.

Limitaciones del tunel rapido: la URL cambia en cada arranque y no hay
SLA. Para una URL fija (`deck.tudominio.com`) hace falta un dominio en
Cloudflare y un *named tunnel* — pendiente para cuando tengas dominio.

## Limitaciones conocidas

- **Ventanas elevadas**: `keys.*` no puede escribir en programas
  ejecutados como administrador, salvo que arranques el servidor desde
  una terminal como administrador (limite de Windows/UIPI).
- **Pantalla siempre encendida**: en la URL http de la LAN se usa un
  truco de video invisible (empieza con el primer toque); en la URL
  https del tunel se usa la API nativa de wake lock.
- Cambios de `server`/`obs` en `deck.config.json` piden reiniciar el
  servidor; los cambios de botones/paginas se aplican en caliente.
