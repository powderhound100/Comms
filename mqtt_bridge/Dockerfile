FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    paho-mqtt>=2.0 \
    aiohttp>=3.9 \
    click>=8.0

COPY mqtt_bridge.py .

EXPOSE 8790 8791

CMD ["python", "mqtt_bridge.py"]
