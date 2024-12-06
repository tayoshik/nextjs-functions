const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");

app.http('SaveThreadFunction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const threadData = await request.json();
            context.log('[DEBUG] Request method:', request.method);
            context.log('[DEBUG] Request body:', threadData);

            // IDの処理を改善（threadIdがある場合はそれを使用）
            const effectiveId = threadData.threadId || threadData.id;

            if (!effectiveId) {
                context.log('[ERROR] No valid ID found in request');
                return {
                    status: 400,
                    jsonBody: { error: "スレッドIDは必須です。" }
                };
            }

            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient("threads");

            await containerClient.createIfNotExists();

            const blobName = `${effectiveId}.json`;
            context.log('[DEBUG] Working with blob:', blobName);

            const blockBlobClient = containerClient.getBlockBlobClient(blobName);

            // 既存のスレッドをチェック
            let existingData;
            try {
                const exists = await blockBlobClient.exists();
                if (exists) {
                    const downloadResponse = await blockBlobClient.download();
                    const content = await streamToBuffer(downloadResponse.readableStreamBody);
                    existingData = JSON.parse(content.toString());
                    context.log('[DEBUG] Found existing thread:', existingData);
                }
            } catch (error) {
                context.log('[ERROR] Error checking existing thread:', error);
            }

            // 新規スレッドまたは更新データの準備
            const data = JSON.stringify({
                id: effectiveId,
                title: threadData.title || existingData?.title || "No Title",
                timestamp: threadData.timestamp || new Date().toISOString(),
                posts: existingData?.posts || []
            });

            await blockBlobClient.upload(data, Buffer.byteLength(data), { overwrite: true });
            context.log('[DEBUG] Thread saved with ID:', effectiveId);

            return {
                status: 201,
                jsonBody: {
                    message: "スレッドを作成/更新しました",
                    threadId: effectiveId
                }
            };

        } catch (error) {
            context.log.error('[ERROR] SaveThreadFunction error:', error);
            context.log.error('[ERROR] Stack trace:', error.stack);
            return {
                status: 500,
                jsonBody: { error: "スレッドの作成中にエラーが発生しました。" }
            };
        }
    }
});

// ストリームをバッファに変換するユーティリティ関数
async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data instanceof Buffer ? data : Buffer.from(data));
        });
        readableStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        readableStream.on("error", reject);
    });
}