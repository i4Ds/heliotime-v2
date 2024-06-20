from fastapi import FastAPI

app = FastAPI()


@app.get('/xray-flux')
def xray_flux():
    return []
