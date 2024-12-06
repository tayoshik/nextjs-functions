const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('saveThread', {
    methods: ['POST'], // POST メソッドを処理
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log(`[DEBUG] Request method: ${request.method}`);

            // リクエストボディを JSON として解析
            const body = await request.json();
            context.log(`[DEBUG] Request body:`, body);

            const { threadId, title, posts } = body;

            // バリデーション: 必須項目の確認
            if (!threadId || !title || !Array.isArray(posts)) {
                context.log.error(`[ERROR] Invalid request body:`, body);
                return {
                    status: 400,
                    jsonBody: {
                        message: 'Invalid Request',
                        details: 'threadId, title, and a valid posts array are required.',
                    },
                };
            }

            // Blobサービスクライアントの作成
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient('threads');

            // Blobクライアントの取得
            const blobClient = containerClient.getBlockBlobClient(`${threadId}.json`);
            const exists = await blobClient.exists();

            let thread;

            if (exists) {
                // Blobが存在する場合、その内容を取得して解析
                const downloadResponse = await blobClient.download();
                const threadData = await streamToString(downloadResponse.readableStreamBody);
                thread = JSON.parse(threadData);

                // スレッドのタイトルと投稿を更新
                thread.title = title;
                thread.posts = posts;
            } else {
                // Blobが存在しない場合、新しいスレッドを作成
                thread = {
                    id: threadId,
                    title,
                    posts,
                };
            }

            // 更新されたデータをBlobに保存
            const updatedData = JSON.stringify(thread, null, 2);
            await blobClient.upload(Buffer.from(updatedData), updatedData.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' },
            });

            context.log(`[DEBUG] Thread saved: ${threadId}`);
            return {
                status: 200,
                jsonBody: {
                    message: 'Thread Saved',
                    thread,
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

// StreamをStringに変換するユーティリティ関数
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(Buffer.from(data));
        });
        readableStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        readableStream.on('error', reject);
    });
}
