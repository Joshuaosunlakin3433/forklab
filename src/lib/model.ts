/**
 * Provider-swappable chat model factory.
 *
 * getModel() returns a LangChain chat model selected by MODEL_PROVIDER, so the
 * provider can be swapped with a single env change and zero code changes
 * elsewhere. Only the `groq` branch is implemented in this step; `gemini` and
 * `ollama` are explicit stubs to fill in later.
 */
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function getModel(): BaseChatModel {
  const provider = (process.env.MODEL_PROVIDER ?? "groq").toLowerCase();
  const model = process.env.MODEL_NAME;

  switch (provider) {
    case "groq": {
      // Groq exposes an OpenAI-compatible endpoint, so we drive it through
      // ChatOpenAI with a custom baseURL.
      if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is not set");
      }
      if (!model) {
        throw new Error("MODEL_NAME is not set");
      }
      return new ChatOpenAI({
        apiKey: process.env.GROQ_API_KEY,
        model,
        temperature: 0,
        configuration: {
          baseURL: GROQ_BASE_URL,
        },
      });
    }

    case "gemini":
      // TODO: implement Gemini provider (e.g. @langchain/google-genai's
      // ChatGoogleGenerativeAI) reading GEMINI_API_KEY and MODEL_NAME.
      throw new Error("gemini provider not yet implemented");

    case "ollama":
      // TODO: implement Ollama provider (e.g. @langchain/ollama's ChatOllama)
      // reading MODEL_NAME and a base URL.
      throw new Error("ollama provider not yet implemented");

    default:
      throw new Error(`Unknown MODEL_PROVIDER: ${provider}`);
  }
}
