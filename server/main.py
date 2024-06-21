from fastapi import FastAPI

app = FastAPI()


@app.get('/flux')
def flux():
    return []
