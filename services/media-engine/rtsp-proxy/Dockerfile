FROM python:3.11-alpine

WORKDIR /app

RUN pip install --no-cache-dir cryptography redis \
    && adduser -D -u 10001 appuser

COPY proxy.py /app/
RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 8555
CMD ["python", "-u", "/app/proxy.py"]
