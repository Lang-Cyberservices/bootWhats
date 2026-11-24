<?php

declare(strict_types=1);

namespace Gestao;

/**
 * Chamada REST ao generateContent do Gemini, com a mesma GEMINI_API_KEY/GEMINI_MODEL do bot.
 * Toda falha lança RuntimeException — quem chama decide o que mostrar ao usuário.
 */
final class GeminiClient
{
    private const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent';
    private const TIMEOUT_SECONDS = 25;

    public function __construct(private string $apiKey, private string $model)
    {
    }

    public static function fromEnv(): ?self
    {
        $key = Config::env('GEMINI_API_KEY');
        if ($key === null) {
            return null;
        }
        return new self($key, Config::env('GEMINI_MODEL', 'gemini-2.0-flash'));
    }

    /**
     * Pede uma resposta em JSON que siga $schema (formato responseSchema da API).
     *
     * @param array<string, mixed> $schema
     * @return array<string, mixed>
     */
    public function generateJson(string $systemInstruction, string $userText, array $schema): array
    {
        $payload = [
            'systemInstruction' => ['parts' => [['text' => $systemInstruction]]],
            'contents' => [['role' => 'user', 'parts' => [['text' => $userText]]]],
            'generationConfig' => [
                'temperature' => 0.9,
                'responseMimeType' => 'application/json',
                'responseSchema' => $schema,
            ],
        ];

        $ch = curl_init(sprintf(self::ENDPOINT, rawurlencode($this->model)));
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $this->apiKey,
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]);

        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($ch);

        if ($body === false) {
            throw new \RuntimeException('Gemini: falha de rede: ' . $curlError);
        }
        if ($status < 200 || $status >= 300) {
            throw new \RuntimeException(sprintf('Gemini: HTTP %d: %s', $status, mb_substr((string) $body, 0, 500)));
        }

        $response = json_decode((string) $body, true);
        $text = $response['candidates'][0]['content']['parts'][0]['text'] ?? null;
        if (!is_string($text)) {
            $reason = $response['candidates'][0]['finishReason'] ?? $response['promptFeedback']['blockReason'] ?? 'sem texto';
            throw new \RuntimeException('Gemini: resposta vazia (' . $reason . ')');
        }

        $data = json_decode($text, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Gemini: JSON inválido: ' . mb_substr($text, 0, 500));
        }
        return $data;
    }
}
