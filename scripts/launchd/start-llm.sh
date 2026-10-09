#!/bin/zsh
# Modelo local para la ficha, los titulares, el narrador y la tesis (9/10). Ver packages/reasoner/src/local.
# Por qué: el plan gratis de Gemini dio 98 llamadas buenas el 9/10 contra 83 COMPRAR que necesitaban ficha.
# Elegido midiendo con `apps/api/src/comparar-fichas.ts`: el 9B inventaba (CART "opera Coinbase").
# Contexto de 64k porque la tesis manda hasta ~44k tokens de documentos.
MODELO="${LOCAL_LLM_GGUF:-$HOME/modelos/Qwen3.6-27B-Q6_K.gguf}"
exec /opt/homebrew/bin/llama-server -m "$MODELO" --host 127.0.0.1 --port 8091 -c 65536 -ngl 99 --jinja -np 1
