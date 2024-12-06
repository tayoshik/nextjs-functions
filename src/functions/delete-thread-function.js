const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('deleteThread', {
    methods: ['DELETE'], // DELETE メソッドを処理
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log(`[DEBUG] Request method: ${request.method}`);

            // リクエストボディを JSON として解析
            const body = await request.json();
            context.log(`[DEBUG] Request body:`, body);

            const { threadId } = body;

            // バリデーション: 必須項目の確認
            if (!threadId) {
                context.log.error(`[ERROR] Invalid request body:`, body);
                return {
                    status: 400,
                    jsonBody: {
                        message: 'Invalid Request',
                        details: 'threadId is required.',
                    },
                };
            }

            // Blobサービスクライアントの作成
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient('threads');

            // Blobを取得
            const blobClient = containerClient.getBlockBlobClient(`${threadId}.json`);
            const exists = await blobClient.exists();

            if (!exists) {
                context.log.error(`[ERROR] Thread file not found: ${threadId}.json`);
                return {
                    status: 404,
                    jsonBody: {
                        message: 'Thread Not Found',
                        threadId,
                    },
                };
            }

            // Blob を削除
            await blobClient.delete();

            context.log(`[DEBUG] Thread deleted: ${threadId}`);
            return {
                status: 200,
                jsonBody: {
                    message: 'Thread Deleted',
                    threadId,
                },
            };
        } catch (error) {
            context.log.error(`[ERROR] Failed to process request:`, error);
            return {
                status: 500,
                jsonBody: {
                    message: 'Internal Server Error',
                    error: error.message,
                },
            };
        }
    },
});
