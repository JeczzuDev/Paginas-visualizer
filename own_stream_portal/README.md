# Own Stream Portal

Deck de control para streaming en el navegador (reemplazo de Touch Portal).
Un servidor Node.js corre en el PC de streaming y sirve una cuadricula de
botones a cualquier navegador (movil o PC) en la red local. Los botones
controlan OBS, envian atajos de teclado, teclas multimedia, volumen y
lanzan programas.

El layout vive en `deck.config.json`: al guardar el archivo, todos los
navegadores conectados se actualizan al instante (sin apps moviles que se
queden con botones viejos).

## Requisitos

- Windows 10/11 con Node.js 22+
- OBS Studio 28+ (el servidor WebSocket viene integrado)

## Puesta en marcha

_(instrucciones completas al terminar la v1)_

```
npm install
copy .env.example .env   # y rellena OBS_PASSWORD
npm start
```

Escanea el QR que aparece en consola con el movil (misma red Wi-Fi).
