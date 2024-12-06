const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('deletePost', {
    methods: ['DELETE'], // DELETE メソッドを処理
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log(`[DEBUG] Request method: ${request.method}`);

            // リクエストボディを JSON として解析
            const body = await request.json();
            context.log(`[DEBUG] Request body:`, body);

            const { threadId, postId } = body;

            // バリデーション: 必須項目の確認
            if (!threadId || !postId) {
                context.log.error(`[ERROR] Invalid request body:`, body);
                return {
                    status: 400,
                    jsonBody: {
                        message: 'Invalid Request',
                        details: 'threadId and postId are required.',
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

            // Blobの内容を取得
            const downloadResponse = await blobClient.download();
            const threadData = await streamToString(downloadResponse.readableStreamBody);
            const thread = JSON.parse(threadData);

            // 投稿を検索して削除
            const postIndex = thread.posts.findIndex((post) => post.id === postId);

            if (postIndex === -1) {
                context.log.error(`[ERROR] Post not found: ${postId}`);
                return {
                    status: 404,
                    jsonBody: {
                        message: 'Post Not Found',
                        threadId,
                        postId,
                    },
                };
            }

            // 投稿を配列から削除
            const deletedPost = thread.posts.splice(postIndex, 1)[0];

            // 更新されたデータをBlobに保存
            const updatedData = JSON.stringify(thread, null, 2);
            await blobClient.upload(Buffer.from(updatedData), updatedData.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' },
            });

            context.log(`[DEBUG] Post deleted from thread ${threadId}:`, deletedPost);
            return {
                status: 200,
                jsonBody: {
                    message: 'Post Deleted',
                    deletedPost,
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
