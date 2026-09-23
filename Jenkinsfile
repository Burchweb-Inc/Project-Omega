import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    stages {
        stage('Build') {
            steps {
                echo 'Building';
                docker.build '${env.BUILD_TAG}'
            }
        }
    }
}
