# ShopAIKey Image API Setup Prompt

Use this prompt when configuring another tool to create images through the ShopAIKey API.

## Required API Configuration

ShopAIKey provides an OpenAI-compatible image API. Configure the client with these environment variables:

```env
SHOPAIKEY_API_KEY=your_shopaikey_api_key_here
SHOPAIKEY_BASE_URL=https://direct.shopaikey.com/v1
SHOPAIKEY_IMAGE_MODEL=gpt-image-2
```

Rules:

- Read the API key from `SHOPAIKEY_API_KEY`. Never hard-code it in source code.
- Use `SHOPAIKEY_BASE_URL` as the client `base_url`.
- The default base URL is `https://direct.shopaikey.com/v1`.
- Do not append another `/v1` when building the request URL. The base URL already contains it.
- Allow `SHOPAIKEY_BASE_URL` and `SHOPAIKEY_IMAGE_MODEL` to be overridden through environment variables.
- The default image model is `gpt-image-2`.
- Keep the API key out of logs, browser bundles, public configuration, and version control.
- Load `.env` only on the server side for applications with a frontend and backend.

Create a `.env.example` file with the same variable names but a placeholder key. Do not commit the real `.env` file.

## API Routes

Use the following OpenAI-compatible route for text-to-image generation:

```text
POST https://direct.shopaikey.com/v1/images/generations
```

When `SHOPAIKEY_BASE_URL` is configured, construct it as:

```text
${SHOPAIKEY_BASE_URL}/images/generations
```

Do not construct it as `${SHOPAIKEY_BASE_URL}/v1/images/generations`.

## Request Parameters

Send a JSON request with:

```json
{
  "model": "gpt-image-2",
  "prompt": "Describe the image to generate.",
  "size": "1536x1024",
  "quality": "high",
  "output_format": "png"
}
```

Use the selected model from `SHOPAIKEY_IMAGE_MODEL`, falling back to `gpt-image-2` when it is not set. Keep `prompt`, `size`, `quality`, and `output_format` configurable by the calling tool.

## Raw HTTP Example

```bash
curl -X POST "${SHOPAIKEY_BASE_URL}/images/generations" \
  -H "Authorization: Bearer ${SHOPAIKEY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Describe the image to generate.",
    "size": "1536x1024",
    "quality": "high",
    "output_format": "png"
  }'
```

The URL must be assembled from `SHOPAIKEY_BASE_URL`, so deployments can change the API host without changing application code.

## OpenAI-Compatible Python Client

```python
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.environ["SHOPAIKEY_API_KEY"],
    base_url=os.getenv(
        "SHOPAIKEY_BASE_URL",
        "https://direct.shopaikey.com/v1",
    ),
)

response = client.images.generate(
    model=os.getenv("SHOPAIKEY_IMAGE_MODEL", "gpt-image-2"),
    prompt="Describe the image to generate.",
    size="1536x1024",
    quality="high",
    output_format="png",
)
```

Install the client dependencies when using this example:

```bash
pip install openai python-dotenv
```

## OpenAI-Compatible JavaScript Client

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.SHOPAIKEY_API_KEY,
  baseURL: process.env.SHOPAIKEY_BASE_URL || "https://direct.shopaikey.com/v1",
});

const response = await client.images.generate({
  model: process.env.SHOPAIKEY_IMAGE_MODEL || "gpt-image-2",
  prompt: "Describe the image to generate.",
  size: "1536x1024",
  quality: "high",
  output_format: "png",
});
```

The JavaScript client and API key must run in a trusted server environment. Do not expose the key in client-side React, Vue, browser JavaScript, or public HTML.

## Response Handling

Read the generated image from the API response. Support these compatible response fields:

- `data[0].b64_json`: base64-encoded image data
- `data[0].url`: temporary image URL

If the provider returns an error, preserve the HTTP status and provider error message. Make configuration errors explicit, especially missing `SHOPAIKEY_API_KEY`, invalid `SHOPAIKEY_BASE_URL`, unsupported model, invalid request parameters, timeout, quota, or rate limit.

## Configuration Checklist

- `SHOPAIKEY_API_KEY` is loaded from a server-side environment variable.
- `SHOPAIKEY_BASE_URL` defaults to `https://direct.shopaikey.com/v1`.
- The request route is `/images/generations` after the configured base URL.
- The final request URL contains exactly one `/v1` segment.
- `SHOPAIKEY_IMAGE_MODEL` defaults to `gpt-image-2`.
- The request uses `Authorization: Bearer <API key>`.
- The API key is never exposed to the browser or logs.
