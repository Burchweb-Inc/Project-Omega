import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    stages {
        stage('Build') {
            environment {
                TAG = "project-omega:branch-${GIT_LOCAL_BRANCH}-latest"
            }
            steps {
                echo "Building ${TAG}"
                script {
                    docker.build(env.TAG)
                }
            }
        }
    }
}
