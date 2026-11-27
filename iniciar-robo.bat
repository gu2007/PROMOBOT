@echo off
title PROMOBOT - Robo automatico (coleta + revisao)
cd /d C:\PROMOBOT
echo Robo automatico do PROMOBOT. Deixe esta janela aberta.
echo Para parar: feche a janela ou aperte Ctrl+C.
echo.
node coletor\automatico.js
echo.
echo O robo parou. Aperte uma tecla para fechar.
pause >nul
